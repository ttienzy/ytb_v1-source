// Cấu trúc điều hướng THUẦN (không icon/React) — nguồn duy nhất cho sidebar và Tài liệu hướng dẫn.
// constants.ts gắn icon lên đây; help dùng PageId để đổi tên trang mà quên sửa tài liệu sẽ lỗi typecheck.

export const NAV_STRUCTURE = [
  { title: 'Tổng Quan', items: [{ label: 'Dashboard' }] },
  {
    title: 'Tạo Video AI',
    items: [
      { label: 'Canvas AI', badge: 'PRO', badgeVariant: 'pro' },
      { label: 'Chiến dịch AI', badge: 'NEW', badgeVariant: 'new' },
      { label: 'Veo Studio' },
      { label: 'Muse Studio', badge: 'NEW', badgeVariant: 'new' },
      { label: 'Recap & Audio' },
    ],
  },
  {
    title: 'Nguồn Nội Dung',
    items: [{ label: 'Khám Phá Kênh' }, { label: 'Crawl truyện' }, { label: 'Video' }],
  },
  {
    title: 'Tiện Ích Biên Tập',
    items: [{ label: 'Voices' }, { label: 'Thư viện nhạc' }, { label: 'Xóa Watermark' }],
  },
  {
    title: 'Phân Phối & Hệ Thống',
    items: [
      { label: 'Lên lịch Pippit' },
      { label: 'Lên lịch Youtube' },
      { label: 'Lịch sử' },
      { label: 'Cài đặt' },
    ],
  },
] as const

type Group = (typeof NAV_STRUCTURE)[number]
export type PageId = Group['items'][number]['label']

export const PAGE_IDS: PageId[] = NAV_STRUCTURE.flatMap(group => group.items.map(item => item.label as PageId))

export function isPageId(value: string): value is PageId {
  return (PAGE_IDS as string[]).includes(value)
}
