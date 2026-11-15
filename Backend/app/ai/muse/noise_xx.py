"""Noise_XX_25519_AESGCM_SHA256 tối giản (Noise Protocol Framework rev. 34).

Đủ cho gateway Muse (`wss://hatch.metaaivm.com/v1/noise`): bắt tay XX 3 bước
với payload rỗng, rồi mã hóa/giải mã transport. Chỉ dùng `cryptography`
(đã có trong requirements), không thêm thư viện noise riêng.

    -> e
    <- e, ee, s, es
    -> s, se
"""
from __future__ import annotations

import hashlib
import hmac
import os
from typing import Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PROTOCOL_NAME = b"Noise_XX_25519_AESGCM_SHA256"
DHLEN = 32
HASHLEN = 32
TAGLEN = 16
MAX_MESSAGE = 65535
_RAW = dict(encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)


class NoiseError(RuntimeError):
    pass


def _hash(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def _hkdf(ck: bytes, ikm: bytes, n: int) -> tuple[bytes, ...]:
    temp = hmac.new(ck, ikm, hashlib.sha256).digest()
    out1 = hmac.new(temp, b"\x01", hashlib.sha256).digest()
    out2 = hmac.new(temp, out1 + b"\x02", hashlib.sha256).digest()
    if n == 2:
        return out1, out2
    out3 = hmac.new(temp, out2 + b"\x03", hashlib.sha256).digest()
    return out1, out2, out3


class _KeyPair:
    def __init__(self, private: Optional[bytes] = None):
        self.priv = X25519PrivateKey.from_private_bytes(private) if private else X25519PrivateKey.generate()
        self.pub = self.priv.public_key().public_bytes(**_RAW)

    def dh(self, remote_pub: bytes) -> bytes:
        return self.priv.exchange(X25519PublicKey.from_public_bytes(remote_pub))


class CipherState:
    """Khóa AES-GCM + bộ đếm nonce (8 byte big-endian sau 4 byte 0)."""

    def __init__(self, key: Optional[bytes] = None):
        self.k = key
        self.n = 0

    def has_key(self) -> bool:
        return self.k is not None

    def _nonce(self) -> bytes:
        if self.n >= 2**64 - 1:
            raise NoiseError("hết nonce")
        return b"\x00\x00\x00\x00" + self.n.to_bytes(8, "big")

    def encrypt(self, ad: bytes, plaintext: bytes) -> bytes:
        if self.k is None:
            return plaintext
        out = AESGCM(self.k).encrypt(self._nonce(), plaintext, ad)
        self.n += 1
        return out

    def decrypt(self, ad: bytes, ciphertext: bytes) -> bytes:
        if self.k is None:
            return ciphertext
        try:
            out = AESGCM(self.k).decrypt(self._nonce(), ciphertext, ad)
        except Exception as e:  # InvalidTag
            raise NoiseError("giải mã Noise thất bại (sai khóa hoặc lệch nonce)") from e
        self.n += 1
        return out


class _Symmetric:
    def __init__(self, prologue: bytes = b""):
        name = PROTOCOL_NAME
        self.h = name.ljust(HASHLEN, b"\x00") if len(name) <= HASHLEN else _hash(name)
        self.ck = self.h
        self.cs = CipherState()
        self.mix_hash(prologue)

    def mix_hash(self, data: bytes) -> None:
        self.h = _hash(self.h + data)

    def mix_key(self, ikm: bytes) -> None:
        self.ck, temp_k = _hkdf(self.ck, ikm, 2)
        self.cs = CipherState(temp_k[:32])

    def encrypt_and_hash(self, plaintext: bytes) -> bytes:
        c = self.cs.encrypt(self.h, plaintext)
        self.mix_hash(c)
        return c

    def decrypt_and_hash(self, ciphertext: bytes) -> bytes:
        p = self.cs.decrypt(self.h, ciphertext)
        self.mix_hash(ciphertext)
        return p

    def split(self) -> tuple[CipherState, CipherState]:
        k1, k2 = _hkdf(self.ck, b"", 2)
        return CipherState(k1[:32]), CipherState(k2[:32])


class NoiseXX:
    """Một phía của bắt tay XX. Bên khởi tạo (client) gọi lần lượt:

        m1 = n.write_message(); n.read_message(m2); m3 = n.write_message()

    rồi dùng n.encrypt()/n.decrypt() cho transport.
    """

    def __init__(self, initiator: bool = True, static_private: Optional[bytes] = None, prologue: bytes = b""):
        self.initiator = initiator
        self.ss = _Symmetric(prologue)
        self.s = _KeyPair(static_private or os.urandom(32))
        self.e: Optional[_KeyPair] = None
        self.re: Optional[bytes] = None
        self.rs: Optional[bytes] = None
        self.step = 0  # 0: -> e | 1: <- e,ee,s,es | 2: -> s,se | 3: xong
        self._send: Optional[CipherState] = None
        self._recv: Optional[CipherState] = None

    @property
    def handshake_finished(self) -> bool:
        return self.step >= 3

    @property
    def remote_static(self) -> Optional[bytes]:
        return self.rs

    def _my_turn(self) -> bool:
        # bước 0 và 2 do initiator gửi, bước 1 do responder gửi
        return (self.step in (0, 2)) == self.initiator

    def write_message(self, payload: bytes = b"") -> bytes:
        if self.handshake_finished or not self._my_turn():
            raise NoiseError("không tới lượt gửi trong bắt tay")
        ss = self.ss
        out = b""
        if self.step == 0:  # -> e
            self.e = _KeyPair()
            ss.mix_hash(self.e.pub)
            out += self.e.pub
        elif self.step == 1:  # <- e, ee, s, es   (responder)
            self.e = _KeyPair()
            ss.mix_hash(self.e.pub)
            out += self.e.pub
            ss.mix_key(self.e.dh(self.re))
            out += ss.encrypt_and_hash(self.s.pub)
            ss.mix_key(self.s.dh(self.re))
        else:  # -> s, se   (initiator)
            out += ss.encrypt_and_hash(self.s.pub)
            ss.mix_key(self.s.dh(self.re))
        out += ss.encrypt_and_hash(payload)
        self._advance()
        return out

    def read_message(self, message: bytes) -> bytes:
        if self.handshake_finished or self._my_turn():
            raise NoiseError("không tới lượt nhận trong bắt tay")
        ss = self.ss
        buf = memoryview(bytes(message))
        if self.step == 0:  # responder đọc e
            self.re = bytes(buf[:DHLEN])
            buf = buf[DHLEN:]
            ss.mix_hash(self.re)
        elif self.step == 1:  # initiator đọc e, ee, s, es
            if len(buf) < DHLEN + DHLEN + TAGLEN + TAGLEN:
                raise NoiseError("bản tin bắt tay thứ 2 quá ngắn")
            self.re = bytes(buf[:DHLEN])
            buf = buf[DHLEN:]
            ss.mix_hash(self.re)
            ss.mix_key(self.e.dh(self.re))
            self.rs = ss.decrypt_and_hash(bytes(buf[: DHLEN + TAGLEN]))
            buf = buf[DHLEN + TAGLEN :]
            ss.mix_key(self.e.dh(self.rs))
        else:  # responder đọc s, se
            self.rs = ss.decrypt_and_hash(bytes(buf[: DHLEN + TAGLEN]))
            buf = buf[DHLEN + TAGLEN :]
            ss.mix_key(self.e.dh(self.rs))
        payload = ss.decrypt_and_hash(bytes(buf))
        self._advance()
        return payload

    def _advance(self) -> None:
        self.step += 1
        if self.step == 3:
            c1, c2 = self.ss.split()
            self._send, self._recv = (c1, c2) if self.initiator else (c2, c1)

    def encrypt(self, plaintext: bytes) -> bytes:
        if not self.handshake_finished:
            raise NoiseError("chưa bắt tay xong")
        if len(plaintext) + TAGLEN > MAX_MESSAGE:
            raise NoiseError("bản tin Noise vượt 65535 byte")
        return self._send.encrypt(b"", plaintext)

    def decrypt(self, ciphertext: bytes) -> bytes:
        if not self.handshake_finished:
            raise NoiseError("chưa bắt tay xong")
        return self._recv.decrypt(b"", ciphertext)
