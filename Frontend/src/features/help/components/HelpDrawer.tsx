import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  Film,
  HardDrive,
  HelpCircle,
  Info,
  Layers,
  Lightbulb,
  Mail,
  Mic,
  Settings,
  Sparkles,
  Tv,
  Video,
  Wrench,
  X,
} from 'lucide-react'
import { DOC_LIST, getDocForSidebar } from '../data/docsRegistry'
import type { SidebarDoc } from '../types'
import './HelpDrawer.css'

function renderSubTabIcon(name?: string) {
  switch (name) {
    case 'video':
      return <Video size={13} />
    case 'sparkles':
      return <Sparkles size={13} />
    case 'film':
      return <Film size={13} />
    case 'activity':
      return <Activity size={13} />
    case 'bot':
      return <Bot size={13} />
    case 'mail':
      return <Mail size={13} />
    case 'hard-drive':
      return <HardDrive size={13} />
    case 'youtube':
      return <Tv size={13} />
    case 'mic':
      return <Mic size={13} />
    case 'settings':
      return <Settings size={13} />
    case 'layers':
    default:
      return <Layers size={13} />
  }
}

interface HelpDrawerProps {
  isOpen: boolean
  onClose: () => void
  currentSidebar: string
  onNavigate?: (page: string) => void
}

type TabType = 'quickSteps' | 'features' | 'tips'

export function HelpDrawer({
  isOpen,
  onClose,
  currentSidebar,
  onNavigate,
}: HelpDrawerProps) {
  const [selectedDocId, setSelectedDocId] = useState<string>(currentSidebar)
  const [activeTab, setActiveTab] = useState<TabType>('quickSteps')

  // Cập nhật tài liệu tương ứng khi đổi sidebar hoặc mở drawer
  useEffect(() => {
    if (isOpen) {
      setSelectedDocId(currentSidebar)
      setActiveTab('quickSteps')
    }
  }, [isOpen, currentSidebar])

  // Lắng nghe phím ESC để đóng drawer
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const doc: SidebarDoc = useMemo(() => {
    return getDocForSidebar(selectedDocId)
  }, [selectedDocId])

  if (!isOpen) return null

  const isCurrentPage = selectedDocId === currentSidebar

  return (
    <div className="help-drawer-overlay" onClick={onClose}>
      <aside
        className="help-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        aria-label="Cẩm nang hướng dẫn"
      >
        {/* ── Top Header ── */}
        <div className="help-drawer-header">
          <div className="help-drawer-breadcrumbs">
            <span className="help-breadcrumb-icon">
              <BookOpen size={13} />
            </span>
            <span>Tài Liệu Hướng Dẫn</span>
            <span className="help-breadcrumb-sep">/</span>
            <span className="help-breadcrumb-active">{doc.category}</span>
          </div>

          <button
            type="button"
            className="help-drawer-close-btn"
            onClick={onClose}
            title="Đóng (Esc)"
          >
            <span className="help-esc-tag">Esc</span>
            <X size={15} />
          </button>
        </div>

        {/* ── Page Switcher Dropdown & Title Banner ── */}
        <div className="help-drawer-hero">
          <div className="help-switcher-wrapper">
            <label htmlFor="help-page-selector" className="help-switcher-label">
              Mục hướng dẫn:
            </label>
            <div className="help-select-box">
              <select
                id="help-page-selector"
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                className="help-page-select"
              >
                <optgroup label="1. Điều Hành & Vận Hành">
                  <option value="Dashboard">Dashboard (Trung tâm điều hành)</option>
                  <option value="Lịch sử">Lịch sử (Audit Logs)</option>
                  <option value="Cài đặt">Cài đặt (Hệ thống &amp; API Keys)</option>
                </optgroup>
                <optgroup label="2. Khai Thác & Nghiên Cứu">
                  <option value="Khám Phá Kênh">Khám Phá Kênh (YouTube Intelligence)</option>
                  <option value="Crawl truyện">Crawl truyện (Tiểu thuyết &amp; Audiobooks)</option>
                  <option value="Xóa Watermark">Xóa Watermark (Clean Video)</option>
                </optgroup>
                <optgroup label="3. Sản Xuất & Dựng Video AI">
                  <option value="AI Workflow">AI Workflow (Node-Graph Canvas)</option>
                  <option value="Workflow">Workflow (Batch Studio &amp; Recap)</option>
                  <option value="Veo Studio">Veo Studio (Google Veo &amp; Nano Banana)</option>
                </optgroup>
                <optgroup label="4. Kho Tài Nguyên">
                  <option value="Video">Video (Kho thành phẩm)</option>
                  <option value="Voices">Voices (Giọng đọc AI &amp; TTS)</option>
                  <option value="Thư viện nhạc">Thư viện nhạc (BGM bản quyền)</option>
                </optgroup>
                <optgroup label="5. Lên Lịch & Phát Sóng">
                  <option value="Lên lịch Pippit">Lên lịch Pippit (TikTok &amp; Facebook)</option>
                  <option value="Lên lịch Youtube">Lên lịch YouTube Shorts (Khung giờ vàng)</option>
                </optgroup>
              </select>
              <ChevronDown size={14} className="help-select-arrow" />
            </div>
          </div>

          <div className="help-title-row">
            <h2 className="help-title">{doc.title}</h2>
            <span className="help-badge">{doc.badge}</span>
          </div>
          <p className="help-summary">{doc.summary}</p>

          {!isCurrentPage && onNavigate && (
            <button
              type="button"
              className="help-jump-page-btn"
              onClick={() => {
                onNavigate(selectedDocId)
                onClose()
              }}
            >
              <span>Đi đến trang {selectedDocId}</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>

        {/* ── Segmented Tab Switcher ── */}
        <div className="help-tab-bar">
          <button
            type="button"
            className={`help-tab-btn ${activeTab === 'quickSteps' ? 'active' : ''}`}
            onClick={() => setActiveTab('quickSteps')}
          >
            <CheckCircle2 size={13} />
            <span>1. Quy trình nhanh</span>
          </button>
          <button
            type="button"
            className={`help-tab-btn ${activeTab === 'features' ? 'active' : ''}`}
            onClick={() => setActiveTab('features')}
          >
            <Info size={13} />
            <span>2. Chi tiết tính năng</span>
          </button>
          <button
            type="button"
            className={`help-tab-btn ${activeTab === 'tips' ? 'active' : ''}`}
            onClick={() => setActiveTab('tips')}
          >
            <Lightbulb size={13} />
            <span>3. Mẹo & Xử lý lỗi</span>
          </button>
        </div>

        {/* ── Scrollable Tab Content ── */}
        <div className="help-drawer-body">
          {activeTab === 'quickSteps' && (
            <div className="help-steps-view">
              <div className="help-section-intro">
                <Sparkles size={14} className="help-intro-icon" />
                <span>Thực hiện tuần tự các bước sau để bắt đầu nhanh:</span>
              </div>

              <div className="help-steps-list">
                {doc.quickSteps.map((step) => (
                  <div key={step.step} className="help-step-card">
                    <div className="help-step-number">{step.step}</div>
                    <div className="help-step-content">
                      <div className="help-step-header">
                        <h4 className="help-step-title">{step.title}</h4>
                        {step.badge && (
                          <span className="help-step-badge">{step.badge}</span>
                        )}
                      </div>
                      <p className="help-step-desc">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Nếu phân hệ có các sub-tabs, hiển thị chi tiết luồng thao tác từng tab kèm mũi tên */}
              {doc.subTabs && doc.subTabs.length > 0 && (
                <div className="help-subtabs-block">
                  <div className="help-subtabs-title">
                    <Layers size={14} className="help-subtabs-title-icon" />
                    <span>Chi tiết các phân tab &amp; Luồng thao tác:</span>
                  </div>

                  <div className="help-subtabs-list">
                    {doc.subTabs.map((subTab) => (
                      <div key={subTab.id} className="help-subtab-card">
                        <div className="help-subtab-top">
                          <div className="help-subtab-badge">
                            <span className="help-subtab-icon">
                              {renderSubTabIcon(subTab.iconName)}
                            </span>
                            <span className="help-subtab-label">{subTab.label}</span>
                          </div>
                        </div>

                        <p className="help-subtab-desc">{subTab.desc}</p>

                        {subTab.flowSteps && subTab.flowSteps.length > 0 && (
                          <div className="help-subtab-flow">
                            <span className="help-flow-tag">Luồng chuyển tiếp:</span>
                            <div className="help-flow-chain">
                              {subTab.flowSteps.map((step, idx) => (
                                <span key={idx} className="help-flow-node">
                                  <span className="help-flow-pill">
                                    <span className="help-flow-step-num">{idx + 1}</span>
                                    <span>{step}</span>
                                  </span>
                                  {idx < subTab.flowSteps!.length - 1 && (
                                    <span className="help-flow-arrow" aria-hidden="true">
                                      →
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'features' && (
            <div className="help-features-view">
              <div className="help-features-list">
                {doc.features.map((feat, idx) => (
                  <div key={idx} className="help-feature-card">
                    <div className="help-feature-header">
                      <h4 className="help-feature-title">{feat.title}</h4>
                      {feat.tag && (
                        <span className="help-feature-tag">{feat.tag}</span>
                      )}
                    </div>
                    <p className="help-feature-desc">{feat.desc}</p>
                    {feat.tip && (
                      <div className="help-feature-tip">
                        <Lightbulb size={12} />
                        <span>{feat.tip}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'tips' && (
            <div className="help-tips-view">
              {/* Pro Tips Section */}
              <div className="help-tips-block">
                <h4 className="help-block-title">
                  <Sparkles size={14} />
                  <span>Kinh nghiệm thực chiến (Pro Tips)</span>
                </h4>
                <ul className="help-tips-list">
                  {doc.proTips.map((tip, idx) => (
                    <li key={idx} className="help-tip-item">
                      <span className="help-tip-bullet" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Troubleshooting Section */}
              {doc.troubleshooting && doc.troubleshooting.length > 0 && (
                <div className="help-trouble-block">
                  <h4 className="help-block-title">
                    <Wrench size={14} />
                    <span>Câu hỏi thường gặp & Khắc phục lỗi</span>
                  </h4>
                  <div className="help-trouble-list">
                    {doc.troubleshooting.map((item, idx) => (
                      <div key={idx} className="help-trouble-item">
                        <div className="help-trouble-q">
                          <AlertCircle size={13} className="help-q-icon" />
                          <span>{item.issue}</span>
                        </div>
                        <div className="help-trouble-a">
                          <p>{item.solution}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="help-drawer-footer">
          <div className="help-footer-hint">
            <span>Mẹo: Bấm phím </span>
            <kbd className="help-kbd">Esc</kbd>
            <span> để đóng nhanh</span>
          </div>
          <button
            type="button"
            className="help-footer-close-btn"
            onClick={onClose}
          >
            Đã hiểu
          </button>
        </div>
      </aside>
    </div>
  )
}
