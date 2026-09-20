import React from 'react'
import { Film, Crosshair, Sparkles, Layers } from 'lucide-react'
import type { WorkflowTabId, WorkflowTabItem } from '../types'
import { DEFAULT_WORKFLOW_TABS } from '../types'

interface WorkflowTabsProps {
  tabs?: WorkflowTabItem[]
  activeTab: WorkflowTabId
  onTabChange: (tabId: WorkflowTabId) => void
  className?: string
}

export function WorkflowTabs({
  tabs = DEFAULT_WORKFLOW_TABS,
  activeTab,
  onTabChange,
  className = '',
}: WorkflowTabsProps) {
  const renderIcon = (iconName: WorkflowTabItem['iconName'], isActive: boolean) => {
    const size = 13
    const color = isActive ? '#0f172a' : '#64748b'

    switch (iconName) {
      case 'film':
        return <Film size={size} color={color} />
      case 'crosshair':
        return <Crosshair size={size} color={color} />
      case 'layers':
        return <Layers size={size} color={color} />
      case 'sparkles':
      default:
        return <Sparkles size={size} color={color} />
    }
  }

  return (
    <nav
      className={`wf-tabs-container ${className}`}
      role="tablist"
      aria-label="Chế độ làm việc AI Workflow"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`wf-tab-item ${isActive ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
            title={tab.description}
          >
            <span className="wf-tab-icon-wrap">{renderIcon(tab.iconName, isActive)}</span>
            <span className="wf-tab-title">{tab.title}</span>

            {tab.badge && (
              <span
                className={`wf-tab-badge wf-badge-${tab.badgeType || 'count'}`}
                aria-label={tab.badge}
              >
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
