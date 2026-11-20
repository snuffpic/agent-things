window.__ModuleLoader__.load({
  id: "agent-things-dsh",
  factory: function(require) {
    var module = { exports: {} };
    var exports = module.exports;
    var __AGENT_THINGS_VERSION__ = "1.3.4";
    var __AGENT_THINGS_SIDEBAR_HTML__ = "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Agent Things 会话任务进度 · 任务进展</title>\n  <style>\n    :root {\n      --accent: var(--primary, #2F75C3);\n      --accent-hover: color-mix(in oklab, var(--accent) 88%, var(--at-ink, #000));\n      --accent-pressed: color-mix(in oklab, var(--accent) 78%, var(--at-ink, #000));\n      --on-accent: var(--primary-foreground, #ffffff);\n      --ease-out: cubic-bezier(0.23, 1, 0.32, 1);\n      --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);\n      --at-ink: #e6edf3;\n      --at-secondary: #a0a6ad;\n      --at-muted: #828c96;\n      --at-note: #bbc3ca;\n      --at-track: #ffffff12;\n      --at-line: #ffffff14;\n      --at-input-border: #ffffff18;\n      --at-input-bg: #ffffff03;\n      --at-hover: #ffffff09;\n      --at-selected: #ffffff10;\n      --at-source-bg: #ffffff0a;\n      --at-number-line: #ffffff25;\n      --at-thumb: #ffffff;\n      --danger: #ef7777;\n      --error: #f7ad86;\n      --at-panel-bg: #0e1318;\n      font: 13px/1.5 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n      color: var(--at-ink);\n      color-scheme: dark;\n    }\n    * {\n      box-sizing: border-box;\n      scrollbar-width: none;\n      -ms-overflow-style: none;\n    }\n    *::-webkit-scrollbar {\n      display: none;\n      width: 0;\n      height: 0;\n    }\n    button, input, textarea {\n      font: inherit;\n      color: inherit;\n    }\n    button {\n      cursor: pointer;\n    }\n    [hidden] {\n      display: none !important;\n    }\n\n    html, body {\n      margin: 0;\n      padding: 0;\n      width: 100%;\n      height: 100%;\n      min-height: 100vh;\n      background: var(--at-panel-bg, #0e1318);\n      color: var(--at-ink);\n      font: 13px/1.5 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n      box-sizing: border-box;\n      overflow-x: hidden;\n      -webkit-font-smoothing: antialiased;\n    }\n\n    .shell {\n      position: relative;\n      width: 100%;\n      max-width: 100%;\n      min-height: 100vh;\n      height: 100%;\n      display: flex;\n      flex-direction: column;\n      background: var(--at-panel-bg, #0e1318);\n      border: none;\n      border-radius: 0;\n      box-shadow: none;\n      padding: 18px 20px 24px;\n      box-sizing: border-box;\n    }\n\n    .title-heading {\n      display: flex;\n      flex: none;\n      align-items: flex-start;\n      gap: 10px;\n      border-radius: 5px;\n      outline-offset: 4px;\n      cursor: default;\n      transition: max-height 200ms var(--ease-out), opacity 180ms var(--ease-out), transform 200ms var(--ease-out);\n      max-height: 60px;\n      opacity: 1;\n      transform: translateY(0);\n      overflow: visible;\n    }\n    .shell.is-scrolled .title-heading {\n      height: 0;\n      min-height: 0;\n      max-height: 0;\n      opacity: 0;\n      visibility: hidden;\n      margin: 0;\n      padding: 0;\n      transform: translateY(-10px);\n      overflow: hidden;\n      pointer-events: none;\n    }\n    h2.title {\n      font-size: 24px;\n      font-weight: 650;\n      line-height: 1.3;\n      letter-spacing: -0.5px;\n      margin: 0;\n      min-width: 0;\n      overflow-wrap: anywhere;\n      display: -webkit-box;\n      -webkit-box-orient: vertical;\n      -webkit-line-clamp: 2;\n      overflow: hidden;\n      color: var(--at-ink);\n    }\n\n    .title-progress {\n      display: flex;\n      flex: none;\n      width: 32px;\n      height: 32px;\n      margin-top: 1px;\n    }\n    .title-progress svg {\n      width: 32px;\n      height: 32px;\n      display: block;\n    }\n    .title-progress .progress-pie,\n    .title-progress text {\n      transition: opacity 160ms var(--ease-out), transform 160ms var(--ease-out);\n      transform-origin: 12px 12px;\n      pointer-events: none;\n    }\n    .title-progress text {\n      opacity: 0;\n      transform: scale(0.94);\n    }\n    .title-progress text.progress-unknown {\n      opacity: 1;\n      transform: none;\n    }\n    .title-heading:hover .progress-pie,\n    .title-heading:focus-visible .progress-pie {\n      opacity: 0;\n      transform: scale(0.94);\n    }\n    .title-heading:hover text,\n    .title-heading:focus-visible text {\n      opacity: 1;\n      transform: scale(1);\n    }\n\n    .panel-body {\n      flex: 1;\n      overflow-y: auto;\n      overflow-x: hidden;\n      min-height: 0;\n      margin-top: 14px;\n      scrollbar-width: none;\n      -ms-overflow-style: none;\n      transition: margin-top 200ms var(--ease-out);\n    }\n    .shell.is-scrolled .panel-body {\n      margin-top: 0;\n    }\n    .panel-body {\n      scrollbar-width: thin;\n      scrollbar-color: rgba(255, 255, 255, 0.18) transparent;\n      padding-right: 2px;\n    }\n    .panel-body::-webkit-scrollbar {\n      width: 6px;\n      height: 6px;\n    }\n    .panel-body::-webkit-scrollbar-track {\n      background: transparent;\n    }\n    .panel-body::-webkit-scrollbar-thumb {\n      background: rgba(255, 255, 255, 0.18);\n      border-radius: 4px;\n    }\n\n    .view {\n      padding-bottom: 4px;\n    }\n\n    .status-line {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 16px;\n    }\n    .status-block {\n      transform: translateY(2px);\n      min-width: 0;\n      flex: 1;\n    }\n    .status-name {\n      display: flex;\n      align-items: center;\n      gap: 7px;\n      line-height: 18px;\n      font-size: 13px;\n      min-width: 0;\n    }\n    .status-name > span:last-child {\n      min-width: 0;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .state-dot {\n      width: 10px;\n      height: 10px;\n      border: 1.5px solid;\n      border-radius: 50%;\n      flex: none;\n      background: transparent !important;\n    }\n    .timestamp {\n      font-size: 11px;\n      line-height: 16px;\n      color: var(--at-secondary);\n      margin-top: 2px;\n      margin-left: 17px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .score {\n      display: flex;\n      align-items: baseline;\n      line-height: 1;\n      font-variant-numeric: tabular-nums;\n      flex: none;\n    }\n    .score-number {\n      font-size: 39px;\n      font-weight: 550;\n      letter-spacing: -1px;\n      color: var(--at-ink);\n    }\n    .score-unit {\n      font-size: 15px;\n      color: var(--at-secondary);\n      margin-left: 3px;\n    }\n\n    .meter {\n      height: 4px;\n      background: var(--at-track);\n      border-radius: 999px;\n      margin: 10px 0 8px;\n      overflow: hidden;\n    }\n    .meter::after {\n      content: \"\";\n      display: block;\n      height: 100%;\n      width: var(--fill, 0%);\n      background: var(--mark, var(--accent));\n      border-radius: inherit;\n      transition: width 220ms var(--ease-out), background-color 180ms var(--ease-out);\n    }\n      background: var(--mark, #b4b7be);\n      border-radius: inherit;\n    }\n\n    .totals-row {\n      display: flex;\n      justify-content: space-between;\n      align-items: center;\n      gap: 8px;\n      color: var(--at-secondary);\n    }\n    .totals, .source-label {\n      font-size: 11px;\n      font-weight: 400;\n      line-height: 16px;\n    }\n    .source-label {\n      margin-left: auto;\n      text-align: right;\n      white-space: nowrap;\n    }\n\n    .summary-block {\n      position: relative;\n      margin: 10px 0;\n      outline: none;\n    }\n    .overview-summary {\n      font-size: 13px;\n      line-height: 1.65;\n      color: var(--at-note);\n      display: -webkit-box;\n      -webkit-line-clamp: 3;\n      -webkit-box-orient: vertical;\n      overflow: hidden;\n      white-space: pre-wrap;\n      overflow-wrap: anywhere;\n    }\n    .summary-expand {\n      position: absolute;\n      right: 0;\n      bottom: 0;\n      border: 0;\n      background: linear-gradient(to right, transparent, var(--at-panel-bg) 18px);\n      padding: 0 0 0 22px;\n      color: var(--at-secondary);\n      font-size: 12px;\n      line-height: 21.45px;\n      white-space: nowrap;\n      cursor: pointer;\n    }\n    .summary-expand:hover {\n      color: inherit;\n    }\n    .summary-block.expanded .overview-summary {\n      display: block;\n      -webkit-line-clamp: unset;\n    }\n    .summary-block.expanded .summary-expand {\n      position: static;\n      display: block;\n      margin-left: auto;\n      padding-left: 0;\n      background: none;\n    }\n\n    .actions {\n      display: flex;\n      align-items: center;\n      gap: 14px;\n      margin: 12px 0 14px;\n    }\n    .primary {\n      border: 0;\n      background: var(--accent);\n      color: var(--on-accent, #fff);\n      border-radius: 9px;\n      padding: 9px 14px;\n      font-weight: 550;\n      min-height: 36px;\n      font-size: 13px;\n      white-space: nowrap;\n      flex-shrink: 0;\n      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 1px 2px rgba(0, 0, 0, 0.14);\n      transition: transform 160ms var(--ease-out), background-color 160ms var(--ease-out), opacity 160ms var(--ease-out);\n    }\n    .primary:hover:not(:disabled) {\n      background: var(--accent-hover);\n      color: var(--on-accent, #fff);\n    }\n    .primary:active:not(:disabled) {\n      background: var(--accent-pressed, var(--accent-hover));\n      transform: scale(0.97);\n    }\n    .text-button, .clear, .back {\n      border: 0;\n      background: none;\n      padding: 0;\n      color: var(--at-secondary);\n      font-size: 12px;\n      white-space: nowrap;\n      cursor: pointer;\n      transition: transform 160ms var(--ease-out), color 150ms var(--ease-out);\n    }\n    .text-button:hover, .back:hover {\n      color: inherit;\n    }\n    .text-button:active:not(:disabled), .clear:active:not(:disabled), .back:active:not(:disabled) {\n      transform: scale(0.97);\n    }\n    .actions .clear {\n      margin-left: auto;\n      font-size: 11px;\n      color: var(--at-muted);\n      white-space: nowrap;\n      position: relative;\n    }\n    .actions .clear:hover {\n      color: var(--danger);\n    }\n    .clear-tooltip {\n      position: absolute;\n      right: 0;\n      bottom: calc(100% + 8px);\n      padding: 6px 9px;\n      border-radius: 6px;\n      background: var(--at-panel-bg);\n      color: var(--at-secondary);\n      border: 1px solid var(--at-line);\n      font-size: 11px;\n      pointer-events: none;\n      transform-origin: bottom right;\n      opacity: 0;\n      transform: scale(0.96) translateY(3px);\n      visibility: hidden;\n      transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out), visibility 0s linear 150ms;\n      white-space: nowrap;\n      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.24);\n      z-index: 10;\n    }\n    .clear:is(:hover, :focus-visible) .clear-tooltip {\n      opacity: 1;\n      transform: scale(1) translateY(0);\n      visibility: visible;\n      transition: opacity 150ms var(--ease-out) 160ms, transform 150ms var(--ease-out) 160ms, visibility 0s linear 160ms;\n    }\n\n    .section-head {\n      border-top: 1px solid var(--at-line);\n      padding-top: 10px;\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      margin-bottom: 4px;\n    }\n    .section-head h3 {\n      font-size: 12px;\n      font-weight: 550;\n      margin: 0;\n      color: var(--at-ink);\n    }\n    .remaining-toggle {\n      border: 0;\n      background: none;\n      padding: 0;\n    }\n    .row-detail {\n      font-size: 12px;\n      font-weight: 400;\n      line-height: 18px;\n      color: var(--at-secondary);\n      white-space: nowrap;\n    }\n\n    .task-row {\n      position: relative;\n      display: flex;\n      gap: 9px;\n      align-items: flex-start;\n      padding: 9px 0;\n      overflow: hidden;\n      isolation: isolate;\n    }\n    .task-dot {\n      width: 12px;\n      height: 12px;\n      border: 1.3px solid #c89b38;\n      border-radius: 50%;\n      margin-top: 4px;\n      flex: none;\n    }\n    .task-row[data-status=\"done\"] .task-dot {\n      border-color: #548eea;\n      background: rgba(84, 142, 234, 0.22);\n    }\n    .task-content {\n      min-width: 0;\n      flex: 1;\n    }\n    .task-title {\n      font-size: 13px;\n      line-height: 1.4;\n      color: var(--at-ink);\n      word-break: break-word;\n    }\n    .task-meta {\n      font-size: 10px;\n      color: var(--at-secondary);\n      margin-top: 2px;\n      line-height: 1.4;\n    }\n    .task-source {\n      position: absolute;\n      top: 0;\n      right: 0;\n      bottom: 0;\n      z-index: 1;\n      display: flex;\n      align-items: center;\n      padding-left: 25px;\n      background: linear-gradient(to right, transparent, var(--at-panel-bg, #0e1318) 25px);\n      opacity: 0;\n      pointer-events: none;\n      transform: translateX(6px);\n      transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out);\n    }\n    .task-row:hover .task-source,\n    .task-row:focus-within .task-source {\n      opacity: 1;\n      pointer-events: auto;\n      transform: translateX(0);\n    }\n    .task-source > button {\n      border: 0;\n      border-radius: 6px;\n      background: var(--at-source-bg, #ffffff0a);\n      color: var(--at-ink);\n      padding: 4px 10px;\n      font-size: 11px;\n      white-space: nowrap;\n      cursor: pointer;\n      transition: transform 160ms var(--ease-out), background-color 150ms var(--ease-out);\n    }\n    .task-source > button:active:not(:disabled) {\n      transform: scale(0.96);\n    }\n    .task-source > button:disabled {\n      opacity: 0.65;\n      cursor: wait;\n    }\n\n    .empty {\n      font-size: 12px;\n      color: var(--at-secondary);\n      padding: 8px 0;\n      text-align: left;\n    }\n\n    .quiet-row {\n      border: 0;\n      border-top: 1px solid var(--at-line);\n      display: flex;\n      justify-content: space-between;\n      align-items: center;\n      width: 100%;\n      background: none;\n      color: inherit;\n      padding: 10px 0;\n      text-align: left;\n      font-size: 12px;\n      cursor: pointer;\n      transition: transform 160ms var(--ease-out), color 150ms var(--ease-out);\n    }\n    .quiet-row:active:not(:disabled) {\n      transform: scale(0.988);\n    }\n    .quiet-row span:last-child {\n      color: var(--at-secondary);\n      transition: transform 160ms var(--ease-out), color 150ms var(--ease-out);\n    }\n    .quiet-row:hover span:last-child {\n      transform: translateX(2px);\n    }\n    .quiet-row:hover {\n      color: var(--at-ink);\n    }\n\n    .overview-bottom {\n      margin-top: 8px;\n    }\n\n    .app-update {\n      margin-top: 3px;\n      padding: 10px 11px;\n      background: var(--at-hover);\n      border: 1px solid var(--at-line);\n      border-radius: 10px;\n    }\n    .app-update-row {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 10px;\n    }\n    .app-update-label {\n      font-size: 12px;\n      line-height: 18px;\n      color: var(--at-ink);\n      min-width: 0;\n      overflow-wrap: anywhere;\n    }\n    .app-update-button {\n      flex: none;\n      padding: 5px 10px;\n      min-height: 28px;\n      border-radius: 7px;\n      font-size: 11px;\n    }\n    .app-update-detail {\n      margin-top: 7px;\n      font-size: 11px;\n      line-height: 1.6;\n      color: var(--at-secondary);\n      white-space: pre-wrap;\n      overflow-wrap: anywhere;\n      user-select: text;\n    }\n    .app-update[data-failed=true] .app-update-detail {\n      color: var(--error);\n    }\n\n    .version-bar {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 10px;\n      padding: 10px 0 2px;\n      font-size: 11px;\n      line-height: 16px;\n      color: var(--at-muted);\n    }\n    .version-bar-text {\n      min-width: 0;\n      overflow-wrap: anywhere;\n    }\n    .version-bar[data-failed=true] .version-bar-text {\n      color: var(--error);\n    }\n    .version-check-button {\n      flex: none;\n      font-size: 11px;\n      color: var(--at-muted);\n    }\n    .version-check-button:hover:not(:disabled) {\n      color: inherit;\n    }\n\n    /* Views */\n    .view-heading {\n      position: sticky;\n      top: 0;\n      z-index: 10;\n      background: var(--at-panel-bg);\n      display: flex;\n      justify-content: space-between;\n      align-items: center;\n      padding: 4px 0 10px;\n      margin-bottom: 6px;\n    }\n    .view-heading h3 {\n      font-size: 14px;\n      font-weight: 600;\n      margin: 0;\n      color: var(--at-ink);\n    }\n    .view-heading .back {\n      font-size: 13px;\n      font-weight: 500;\n      color: var(--at-secondary);\n      padding: 4px 8px;\n      margin-right: -6px;\n      border-radius: 6px;\n      cursor: pointer;\n      transition: transform 160ms var(--ease-out), color 150ms var(--ease-out), background-color 150ms var(--ease-out);\n    }\n    .view-heading .back:hover {\n      color: var(--at-ink);\n      background: var(--at-hover);\n    }\n    .view-heading::after {\n      content: \"\";\n      position: absolute;\n      left: -20px;\n      right: -20px;\n      top: 100%;\n      height: 20px;\n      background: linear-gradient(to bottom, var(--at-panel-bg), transparent);\n      pointer-events: none;\n      opacity: 0;\n      transition: opacity 180ms var(--ease-out);\n    }\n    .shell.is-scrolled .view-heading::after {\n      opacity: 1;\n    }\n\n    /* Edit View */\n    .choices-list {\n      display: flex;\n      flex-direction: column;\n      gap: 4px;\n      margin-bottom: 12px;\n    }\n    .choice {\n      display: flex;\n      align-items: center;\n      gap: 10px;\n      width: 100%;\n      padding: 8px 9px;\n      border: 0;\n      border-radius: 7px;\n      background: none;\n      color: inherit;\n      text-align: left;\n      font-size: 13px;\n      cursor: pointer;\n      transition: transform 160ms var(--ease-out), background-color 150ms var(--ease-out);\n    }\n    .choice:hover {\n      background: var(--at-hover);\n    }\n    .choice:active:not(:disabled) {\n      transform: scale(0.988);\n    }\n    .choice[aria-pressed=\"true\"] {\n      background: var(--at-selected);\n    }\n    .dot {\n      width: 12px;\n      height: 12px;\n      border: 1.6px solid var(--mark);\n      border-radius: 50%;\n      flex: none;\n      transition: background-color 180ms var(--ease-out), border-color 180ms var(--ease-out);\n    }\n    .choice[aria-pressed=\"true\"] .dot {\n      background: var(--mark);\n      box-shadow: inset 0 0 0 2px var(--at-panel-bg);\n    }\n\n    .progress-section {\n      margin-top: 20px;\n    }\n    .progress-head {\n      display: flex;\n      justify-content: space-between;\n      align-items: center;\n      margin-bottom: 12px;\n    }\n    .label {\n      font-size: 11px;\n      color: var(--at-secondary);\n    }\n    .number-wrap {\n      display: flex;\n      align-items: center;\n      gap: 5px;\n      color: var(--at-secondary);\n    }\n    .progress-number {\n      appearance: textfield;\n      color: var(--at-ink);\n      width: 65px;\n      padding: 2px 3px 4px;\n      background: none;\n      border: 0;\n      border-bottom: 1px solid var(--at-number-line);\n      font-size: 27px;\n      font-weight: 550;\n      text-align: right;\n      font-variant-numeric: tabular-nums;\n    }\n    .progress-number::-webkit-inner-spin-button {\n      appearance: none;\n    }\n    .range {\n      position: relative;\n      height: 48px;\n      margin-top: 2px;\n      --mark: #c89b38;\n    }\n    .range-track {\n      position: absolute;\n      left: 7px;\n      right: 7px;\n      top: 9px;\n      height: 6px;\n      border-radius: 999px;\n      background: linear-gradient(to right, var(--range-fill, var(--mark)) var(--fill), var(--at-track) var(--fill));\n      pointer-events: none;\n      transition: background-color 160ms var(--ease-out);\n    }\n    .range.is-dragging .range-track {\n      transition: none;\n    }\n    .range-input {\n      position: relative;\n      appearance: none;\n      width: 100%;\n      height: 24px;\n      background: transparent;\n      margin: 0;\n      display: block;\n      padding: 0;\n      cursor: pointer;\n    }\n    .range-input::-webkit-slider-runnable-track {\n      height: 6px;\n      background: transparent;\n    }\n    .range-input::-webkit-slider-thumb {\n      appearance: none;\n      width: 16px;\n      height: 16px;\n      margin-top: -5px;\n      background: var(--at-thumb);\n      border: 0.5px solid rgba(0, 0, 0, 0.14);\n      border-radius: 50%;\n      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28), 0 0 0 0.5px rgba(0, 0, 0, 0.08);\n      transition: transform 150ms var(--ease-out), box-shadow 150ms var(--ease-out);\n    }\n    .range-input:hover::-webkit-slider-thumb {\n      transform: scale(1.06);\n    }\n    .range-input:active::-webkit-slider-thumb {\n      transform: scale(1.1);\n      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.34), 0 0 0 1px rgba(0, 0, 0, 0.12);\n    }\n    .range-nodes {\n      position: absolute;\n      left: 7px;\n      right: 7px;\n      top: 0;\n      pointer-events: none;\n    }\n    .range-node {\n      position: absolute;\n      left: var(--at);\n      top: 8px;\n      width: 0;\n      font-size: 10px;\n      font-weight: 500;\n      opacity: 0.78;\n      color: var(--at-secondary);\n      font-variant-numeric: tabular-nums;\n    }\n    .range-node::before {\n      display: none;\n    }\n    .range-node-label {\n      position: absolute;\n      top: 20px;\n      left: 0;\n      transform: translateX(-50%);\n    }\n    .range-node:first-child .range-node-label {\n      transform: none;\n    }\n    .range-node:last-child .range-node-label {\n      transform: translateX(-100%);\n    }\n    .unknown-row {\n      display: flex;\n      justify-content: flex-end;\n      margin: 2px 0 18px;\n    }\n    .unknown {\n      font-size: 11px;\n      color: var(--at-secondary);\n      border: 0;\n      background: none;\n      padding: 0;\n      cursor: pointer;\n    }\n    .unknown:hover {\n      color: var(--at-ink);\n    }\n\n    .note-label {\n      display: block;\n      font-size: 11px;\n      color: var(--at-secondary);\n      margin-bottom: 8px;\n    }\n    textarea.note-input {\n      display: block;\n      width: 100%;\n      resize: vertical;\n      min-height: 66px;\n      max-height: 140px;\n      background: var(--at-input-bg);\n      color: inherit;\n      border: 1px solid var(--at-input-border);\n      border-radius: 8px;\n      padding: 9px;\n      line-height: 1.6;\n      font-size: 12px;\n    }\n    textarea.note-input:focus-visible {\n      outline: none;\n    }\n\n    .edit-actions {\n      display: flex;\n      justify-content: flex-end;\n      gap: 18px;\n      align-items: center;\n      padding: 21px 0 16px;\n    }\n\n    .feedback-msg {\n      font-size: 11px;\n      color: var(--at-secondary);\n      margin-top: 10px;\n      text-align: right;\n    }\n    .feedback-msg.error {\n      color: var(--error);\n    }\n    .feedback-msg.success {\n      color: #548eea;\n    }\n\n    :root[data-color-mode=\"light\"] {\n      --at-ink: #22272e;\n      --at-secondary: #576374;\n      --at-muted: #667383;\n      --at-note: #46515f;\n      --at-track: #dfe4ea;\n      --at-line: #dfe4ea;\n      --at-input-border: #c7d0da;\n      --at-input-bg: #f7f9fb;\n      --at-hover: #f0f3f6;\n      --at-selected: #e9edf2;\n      --at-source-bg: #e9eef4;\n      --at-number-line: #b6c1ce;\n      --at-thumb: #ffffff;\n      --danger: #bf2f3a;\n      --error: #b13a2d;\n      --at-panel-bg: #ffffff;\n      color: var(--at-ink);\n      color-scheme: light;\n    }\n    html[data-color-mode=\"light\"] .shell {\n      --at-panel-bg: #ffffff;\n      border-color: #dfe4ea;\n      box-shadow: none;\n    }\n    html[data-color-mode=\"light\"] .range {\n      --range-fill: color-mix(in srgb, var(--mark) 85%, #000);\n    }\n\n    @media (prefers-color-scheme: light) {\n      :root:not([data-color-mode=\"dark\"]) {\n        --at-ink: #22272e;\n        --at-secondary: #576374;\n        --at-muted: #667383;\n        --at-note: #46515f;\n        --at-track: #dfe4ea;\n        --at-line: #dfe4ea;\n        --at-input-border: #c7d0da;\n        --at-input-bg: #f7f9fb;\n        --at-hover: #f0f3f6;\n        --at-selected: #e9edf2;\n        --at-source-bg: #e9eef4;\n        --at-number-line: #b6c1ce;\n        --at-thumb: #ffffff;\n        --danger: #bf2f3a;\n        --error: #b13a2d;\n        --at-panel-bg: #ffffff;\n        color: var(--at-ink);\n        color-scheme: light;\n      }\n      html:not([data-color-mode=\"dark\"]) .shell {\n        --at-panel-bg: #ffffff;\n        border-color: #dfe4ea;\n        box-shadow: none;\n      }\n      html:not([data-color-mode=\"dark\"]) .range {\n        --range-fill: color-mix(in srgb, var(--mark) 85%, #000);\n      }\n    }\n    @media (prefers-reduced-motion: reduce) {\n      .primary:active:not(:disabled),\n      .text-button:active:not(:disabled),\n      .clear:active:not(:disabled),\n      .back:active:not(:disabled),\n      .task-source > button:active:not(:disabled),\n      .choice:active:not(:disabled),\n      .quiet-row:active:not(:disabled),\n      .range-input:hover::-webkit-slider-thumb,\n      .range-input:active::-webkit-slider-thumb {\n        transform: none;\n      }\n    }\n  </style>\n  <script src=\"/preload.js\"></script>\n  <script>\n    function syncThemeWithHost() {\n      try {\n        const root = document.documentElement;\n        const styleComp = getComputedStyle(root);\n        const bg = styleComp.getPropertyValue('--background').trim();\n        const fg = styleComp.getPropertyValue('--foreground').trim();\n        const mutedFg = styleComp.getPropertyValue('--muted-foreground').trim();\n\n        let isLight = null;\n        if (bg) {\n          if (bg.startsWith('#') && bg.length >= 7) {\n            const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);\n            isLight = (0.299 * r + 0.587 * g + 0.114 * b) > 130;\n          } else if (bg.startsWith('rgb')) {\n            const m = bg.match(/\\d+/g);\n            if (m && m.length >= 3) isLight = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 130;\n          }\n        }\n        if (isLight === null) {\n          const cfgMode = window.__agentThingsHostTheme?.mode || root.getAttribute('data-color-mode');\n          if (cfgMode === 'light' || cfgMode === 'dark') {\n            isLight = cfgMode === 'light';\n          } else {\n            isLight = Boolean(window.matchMedia?.('(prefers-color-scheme: light)').matches);\n          }\n        }\n\n        const fallbackPrimary = window.__agentThingsHostTheme?.primary || (isLight ? '#2F75C3' : '#2F71E3');\n        const rawPrimary = (styleComp.getPropertyValue('--primary') || styleComp.getPropertyValue('--accent') || '').trim();\n        const primaryColor = rawPrimary || fallbackPrimary;\n        if (!rawPrimary && fallbackPrimary) {\n          root.style.setProperty('--primary', fallbackPrimary);\n        }\n        const primaryFg = styleComp.getPropertyValue('--primary-foreground').trim();\n        let accentRgb = null;\n        const hex6Match = primaryColor.match(/^#([0-9a-f]{6})$/i);\n        const hex3Match = !hex6Match && primaryColor.match(/^#([0-9a-f]{3})$/i);\n        const rgbMatch = !hex6Match && !hex3Match && primaryColor.match(/^rgba?\\(\\s*(\\d{1,3})\\s*[,\\s]\\s*(\\d{1,3})\\s*[,\\s]\\s*(\\d{1,3})/i);\n        if (hex6Match) {\n          const hex = hex6Match[1];\n          accentRgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];\n        } else if (hex3Match) {\n          const h3 = hex3Match[1];\n          accentRgb = [parseInt(h3[0] + h3[0], 16), parseInt(h3[1] + h3[1], 16), parseInt(h3[2] + h3[2], 16)];\n        } else if (rgbMatch) {\n          accentRgb = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];\n        }\n        if (accentRgb) {\n          const lum = accentRgb.reduce((acc, c, i) => {\n            const s = c / 255;\n            const lin = s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);\n            return acc + lin * (i === 0 ? 0.2126 : i === 1 ? 0.7152 : 0.0722);\n          }, 0);\n          const isBrightAccent = lum > 0.45;\n          root.style.setProperty('--on-accent', isBrightAccent ? '#0D0D0D' : (primaryFg || '#FFFFFF'));\n        } else if (primaryFg) {\n          root.style.setProperty('--on-accent', primaryFg);\n        }\n\n        root.setAttribute('data-color-mode', isLight ? 'light' : 'dark');\n        if (isLight) {\n          root.style.setProperty('--at-ink', fg || '#22272e');\n          root.style.setProperty('--at-secondary', mutedFg || '#576374');\n          root.style.setProperty('--at-muted', '#667383');\n          root.style.setProperty('--at-note', '#46515f');\n          root.style.setProperty('--at-panel-bg', '#ffffff');\n          root.style.setProperty('--at-line', '#dfe4ea');\n          root.style.setProperty('--at-track', '#dfe4ea');\n          root.style.setProperty('--at-input-border', '#c7d0da');\n          root.style.setProperty('--at-input-bg', '#f6f8fa');\n          root.style.setProperty('--at-hover', '#f3f4f6');\n          root.style.setProperty('--at-source-bg', '#f6f8fa');\n          root.style.setProperty('color-scheme', 'light');\n        } else {\n          root.style.setProperty('--at-ink', fg || '#e6edf3');\n          root.style.setProperty('--at-secondary', '#a0a6ad');\n          root.style.setProperty('--at-muted', '#828c96');\n          root.style.setProperty('--at-note', '#bbc3ca');\n          root.style.setProperty('--at-panel-bg', '#0e1318');\n          root.style.setProperty('--at-line', '#ffffff14');\n          root.style.setProperty('--at-track', '#ffffff12');\n          root.style.setProperty('--at-input-border', '#ffffff18');\n          root.style.setProperty('--at-input-bg', '#ffffff03');\n          root.style.setProperty('--at-hover', '#ffffff09');\n          root.style.setProperty('--at-source-bg', '#ffffff0a');\n          root.style.setProperty('color-scheme', 'dark');\n        }\n      } catch (_) {}\n    }\n    syncThemeWithHost();\n  </script>\n</head>\n<body>\n  <div class=\"shell\" id=\"agentThingsCard\">\n    <div class=\"title-heading\" tabindex=\"0\">\n      <span class=\"title-progress\" id=\"titleProgress\">\n        <svg viewBox=\"0 0 24 24\" width=\"32\" height=\"32\" aria-hidden=\"true\" style=\"overflow:visible\">\n      <circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"none\" stroke=\"#b4b7be\" stroke-width=\"1.6\" opacity=\"0.85\"/>\n      <text x=\"12\" y=\"12.4\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#b4b7be\" class=\"progress-unknown\" style=\"font:600 6.4px -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:-0.2px;font-variant-numeric:tabular-nums\">—</text>\n    </svg>\n      </span>\n      <h2 class=\"title\" id=\"cardTitle\" title=\"当前会话\">当前会话</h2>\n    </div>\n\n    <div class=\"panel-body\" id=\"panelBody\">\n      <!-- Overview View -->\n      <div id=\"overviewView\" class=\"view overview\">\n        <div class=\"status-line\">\n          <div class=\"status-block\">\n            <div class=\"status-name\">\n              <span class=\"state-dot\" id=\"overviewDot\" style=\"border-color:#b4b7be; background:transparent;\"></span>\n              <span id=\"overviewStatusLabel\">尚未开始</span>\n            </div>\n            <div class=\"timestamp\" id=\"overviewTimestamp\">--/-- --:--</div>\n          </div>\n          <div class=\"score\">\n            <span class=\"score-number\" id=\"overviewScoreNumber\">—</span>\n            <span class=\"score-unit\" hidden>%</span>\n          </div>\n        </div>\n\n        <div class=\"meter\" id=\"overviewMeter\" style=\"--fill:0%; --mark:#b4b7be;\"></div>\n\n        <div class=\"totals-row\">\n          <span class=\"totals\" id=\"overviewTotals\">暂无任务统计</span>\n          <span class=\"source-label\" id=\"overviewSourceLabel\">自动分析</span>\n        </div>\n\n        <div class=\"summary-block\" id=\"summaryBlock\" tabindex=\"0\">\n          <div class=\"overview-summary\" id=\"overviewSummary\">尚未记录进展</div>\n          <button class=\"summary-expand\" id=\"summaryExpand\" onclick=\"toggleSummaryExpand()\" hidden>查看全部</button>\n        </div>\n\n        <div class=\"actions\">\n          <button class=\"primary\" id=\"btnAnalyze\" onclick=\"onAnalyzeClick()\">更新进度</button>\n          <button class=\"text-button\" id=\"btnAdjust\" onclick=\"switchToEdit()\">手动调整</button>\n          <button class=\"clear\" id=\"btnClear\" aria-label=\"清除进度\" onclick=\"onClearClick()\">\n            <span class=\"clear-tooltip\" id=\"clearTooltip\" role=\"tooltip\">立即清除进度与任务记录</span>\n            <span id=\"clearBtnLabel\">清除进度</span>\n          </button>\n        </div>\n\n        <!-- Section Head -->\n        <div class=\"section-head\">\n          <h3 id=\"remainingTasksHeading\">剩余任务 0</h3>\n          <button type=\"button\" class=\"remaining-toggle row-detail\" id=\"btnToggleAllRemaining\" onclick=\"toggleAllRemaining()\" hidden></button>\n        </div>\n\n        <!-- Tasks list -->\n        <div class=\"tasks-list\" id=\"uncompletedTasksList\">\n          <div class=\"empty\">点击更新进度，整理这次会话的任务</div>\n        </div>\n\n        <!-- Bottom Rows (1:1 identical to sidebar) -->\n        <div class=\"overview-bottom\">\n          <button class=\"quiet-row history-open\" onclick=\"switchToHistory()\">\n            <span id=\"completedRowLabel\">已完成任务</span>\n            <span class=\"row-detail\" id=\"historyCount\">0 条 ›</span>\n          </button>\n          <button class=\"quiet-row note-open\" onclick=\"switchToEditNote()\">\n            <span id=\"notesRowLabel\">备注</span>\n            <span class=\"row-detail\" id=\"noteOpenLabel\">添加</span>\n          </button>\n          <div class=\"app-update\" id=\"appUpdateBox\" hidden>\n            <div class=\"app-update-row\">\n              <span class=\"app-update-label\" id=\"appUpdateLabel\" role=\"status\"></span>\n              <button type=\"button\" class=\"primary app-update-button\" id=\"btnAppUpdate\" onclick=\"onUpgradeClick()\">立即升级</button>\n            </div>\n            <div class=\"app-update-detail\" id=\"appUpdateDetail\" hidden></div>\n          </div>\n        </div>\n        <div class=\"version-bar\" id=\"versionBar\" hidden>\n          <span class=\"version-bar-text\" id=\"versionBarText\" role=\"status\"></span>\n          <button type=\"button\" class=\"text-button version-check-button\" id=\"btnCheckUpdate\" onclick=\"onCheckUpdateClick()\">检查更新</button>\n        </div>\n      </div>\n\n      <!-- History View -->\n      <div id=\"historyView\" class=\"view history-view\" hidden>\n        <div class=\"view-heading\">\n          <h3 id=\"historyHeading\">已完成任务</h3>\n          <button class=\"back\" id=\"historyBackBtn\" onclick=\"switchToOverview()\">‹ 返回</button>\n        </div>\n        <div class=\"history-list\" id=\"historyList\">\n          <div class=\"empty\">暂无已完成任务</div>\n        </div>\n      </div>\n\n      <!-- Edit View -->\n      <div id=\"editView\" class=\"view edit-view\" hidden>\n        <div class=\"view-heading\">\n          <h3 id=\"editHeading\">手动记录会话状态</h3>\n          <button class=\"back\" id=\"editBackBtn\" onclick=\"switchToOverview()\">‹ 返回</button>\n        </div>\n        <div class=\"choices-list\">\n          \n            <button class=\"choice\" id=\"choice-unstarted\"  aria-pressed=\"false\" style=\"--mark:#9098a2\" onclick=\"selectState('unstarted')\">\n              <span class=\"dot\"></span>\n              <span class=\"choice-label\">尚未开始</span>\n            </button>\n          \n            <button class=\"choice\" id=\"choice-unfinished\"  aria-pressed=\"true\" style=\"--mark:#c89b38\" onclick=\"selectState('unfinished')\">\n              <span class=\"dot\"></span>\n              <span class=\"choice-label\">有遗留事项</span>\n            </button>\n          \n            <button class=\"choice\" id=\"choice-completed\"  aria-pressed=\"false\" style=\"--mark:#548eea\" onclick=\"selectState('completed')\">\n              <span class=\"dot\"></span>\n              <span class=\"choice-label\">全部完成</span>\n            </button>\n          \n            <button class=\"choice\" id=\"choice-pushed\" hidden aria-pressed=\"false\" style=\"--mark:#a17be3\" onclick=\"selectState('pushed')\">\n              <span class=\"dot\"></span>\n              <span class=\"choice-label\">全部完成并已推送</span>\n            </button>\n          \n        </div>\n\n        <div class=\"progress-section\">\n          <div class=\"progress-head\">\n            <label class=\"label\" id=\"progressFieldLabel\" for=\"inputProgressNumber\">进度</label>\n            <div class=\"number-wrap\">\n              <input type=\"number\" id=\"inputProgressNumber\" class=\"progress-number\" min=\"0\" max=\"100\" step=\"1\" value=\"\" placeholder=\"—\" aria-label=\"进度\" oninput=\"onNumberInput(this.value)\" onkeydown=\"onProgressKeyDown(event)\">\n              <span>%</span>\n            </div>\n          </div>\n\n          <div class=\"range\" id=\"rangeBox\" style=\"--mark:#b4b7be; --fill:0%;\">\n            <div class=\"range-track\"></div>\n            <div class=\"range-nodes\" aria-hidden=\"true\">\n              \n                <span class=\"range-node\" style=\"--at:0%;\">\n                  <span class=\"range-node-label\">0</span>\n                </span>\n              \n                <span class=\"range-node\" style=\"--at:25%;\">\n                  <span class=\"range-node-label\">25</span>\n                </span>\n              \n                <span class=\"range-node\" style=\"--at:50%;\">\n                  <span class=\"range-node-label\">50</span>\n                </span>\n              \n                <span class=\"range-node\" style=\"--at:75%;\">\n                  <span class=\"range-node-label\">75</span>\n                </span>\n              \n                <span class=\"range-node\" style=\"--at:100%;\">\n                  <span class=\"range-node-label\">100</span>\n                </span>\n              \n            </div>\n            <input type=\"range\" id=\"inputSlider\" class=\"range-input\" min=\"0\" max=\"100\" step=\"1\" value=\"0\" aria-label=\"拖动调整进度\" onpointerdown=\"onSliderPointerDown()\" onpointerup=\"onSliderPointerUp()\" onpointercancel=\"onSliderPointerUp()\" oninput=\"onSliderInput(this.value)\">\n          </div>\n\n          <div class=\"unknown-row\">\n            <button type=\"button\" class=\"unknown\" id=\"btnClearProgress\" onclick=\"onClearProgressClick()\">清空进度</button>\n          </div>\n        </div>\n\n        <label class=\"note-label\" id=\"txtNoteLabel\" for=\"txtNote\">备注</label>\n        <textarea id=\"txtNote\" class=\"note-input\" maxlength=\"4000\" placeholder=\"记下下一步要做的事…\" aria-label=\"事项备注\" oninput=\"markFormDirty()\"></textarea>\n\n        <div id=\"conflictBox\" class=\"conflict-box\" style=\"display:none; margin: 10px 0; padding: 8px 12px; background: rgba(230, 80, 80, 0.12); border: 1px solid rgba(230, 80, 80, 0.35); border-radius: 6px; font-size: 12px; line-height: 1.5; color: var(--at-ink);\">\n          <div id=\"conflictMsg\">保存冲突：内容已被其他入口修改。当前草稿已保留。</div>\n          <div style=\"margin-top: 6px;\">\n            <button type=\"button\" class=\"text-button\" id=\"btnResolveConflict\" style=\"color: var(--mark); text-decoration: underline; padding: 0;\" onclick=\"resolveConflictKeepDraft()\">读取最新版本并保留草稿</button>\n          </div>\n        </div>\n\n        <div class=\"edit-actions\">\n          <button class=\"text-button\" id=\"btnCancelEdit\" onclick=\"switchToOverview()\">取消</button>\n          <button class=\"primary\" id=\"btnSaveRecord\" onclick=\"onSaveRecord()\">保存记录</button>\n        </div>\n      </div>\n    </div>\n\n    <div class=\"feedback-msg\" id=\"feedbackMsg\" role=\"status\"></div>\n  </div>\n\n  <script>\n    const injectedI18n = window.__agentThingsI18n || {};\n    function normalizeLang(val) {\n      return val === 'en' ? 'en' : 'zh';\n    }\n    let activeLang = normalizeLang(window.__agentThingsLang || injectedI18n.lang || (navigator.language && navigator.language.toLowerCase().startsWith('en') ? 'en' : 'zh'));\n    const fallbackLocales = {\n      zh: {\n        docTitleSuffix: '任务进展',\n        defaultDocTitle: 'Agent Things 会话任务进度',\n        defaultSessionTitle: '当前会话',\n        labels: {\"unstarted\":\"尚未开始\",\"unfinished\":\"有遗留事项\",\"completed\":\"全部完成\",\"pushed\":\"全部完成并已推送\"},\n        taskLabels: {\"todo\":\"待开始\",\"in_progress\":\"进行中\",\"blocked\":\"受阻\",\"needs_verification\":\"待验收\",\"done\":\"已完成\"},\n        unrecordedSummary: '尚未记录进展',\n        noTasksYet: '暂无任务统计',\n        totalsPattern: '已完成 {done} / {total} 项任务',\n        sourceAuto: '自动分析',\n        btnUpdate: '更新进度',\n        btnUpdating: '正在分析…',\n        btnAdjust: '手动调整',\n        btnClear: '清除进度',\n        clearTooltip: '立即清除进度与任务记录',\n        clearConfirm: '确定要清除本会话的任务进度和记录吗？',\n        clearingFeedback: '正在清除…',\n        clearedFeedback: '✓ 已清空进度',\n        clearFailedPrefix: '清除失败: ',\n        expandAll: '查看全部',\n        collapse: '收起',\n        remainingHeadingPattern: '剩余任务 {count}',\n        showAllCountPattern: '查看全部 {count} 条 ›',\n        collapseArrow: '收起 ›',\n        emptyNoTasks: '点击更新进度，整理这次会话的任务',\n        emptyNoRemaining: '暂无未完成任务',\n        completedHeading: '已完成任务',\n        countArrowPattern: '{count} 条 ›',\n        notesLabel: '备注',\n        addLabel: '添加',\n        editLabel: '编辑',\n        untitledTask: '未命名事项',\n        completedTaskFallback: '已完成事项',\n        viewSource: '查看来源',\n        backLabel: '‹ 返回',\n        emptyCompleted: '暂无已完成任务',\n        editHeading: '手动记录会话状态',\n        progressLabel: '进度',\n        clearValueBtn: '清空进度',\n        notePlaceholder: '记下下一步要做的事…',\n        noteAriaLabel: '事项备注',\n        sliderAriaLabel: '拖动调整进度',\n        cancelBtn: '取消',\n        saveBtn: '保存记录',\n        savingFeedback: '正在保存…',\n        savedFeedback: '✓ 保存成功',\n        saveFailedPrefix: '保存失败: ',\n        conflictBanner: '保存冲突：内容已被其他入口修改。当前草稿已保留。',\n        conflictDetectedFeedback: '保存失败：检测到版本冲突',\n        resolveConflictBtn: '读取最新版本并保留草稿',\n        conflictRebasedFeedback: '基准版本已对齐最新状态，再次点击保存即可提交当前草稿。',\n        startingAnalysisFeedback: '正在开始分析…',\n        analysisNotDonePrefix: '分析未完成: ',\n        analysisAbnormal: '执行异常',\n        updateFailedPrefix: '更新失败: ',\n        locatingShort: '定位中...',\n        locatedJumpMessage: '已跳转并定位到会话来源',\n        locateNotFound: '未找到对应会话消息',\n        locateSent: '已发送定位请求',\n        locateHostUnavailable: '未能连接宿主定位接口',\n        locateFailedPrefix: '定位失败：',\n        unknownActionError: '未知错误',\n        cardOpFailed: '操作失败',\n        cardAuthUnavailable: '获取连接凭据失败',\n        updateStages: { queued: '正在准备升级', checking: '正在检查版本', downloading: '正在下载新版本', waiting: '等待当前分析结束', installing: '正在升级' },\n        updateAvailablePattern: '发现新版本 v{version}',\n        upgradedToPattern: '已升级至 v{version}',\n        updateFailedLabel: '升级失败',\n        upgradeBtn: '立即升级',\n        upgradingShort: '正在升级…',\n        checkUpdateBtn: '检查更新',\n        checkingUpdateShort: '正在检查…',\n        alreadyLatestPattern: '当前已是最新版 v{version}',\n        versionTagPattern: 'v{version}',\n        checkUpdateFailedLabel: '检查更新失败',\n        pleaseWait: '请稍候',\n        completedShort: '已完成',\n        retryBtn: '重试',\n        terminalUpgradePrefix: '终端升级：',\n        reconnectHint: '正在重新连接后台，升级状态将在连接后恢复',\n        reconnectMcpHint: '请在客户端重新连接 MCP 服务',\n      },\n      en: {\n        docTitleSuffix: 'Progress',\n        defaultDocTitle: 'Agent Things Progress',\n        defaultSessionTitle: 'Current session',\n        labels: {\"unstarted\":\"Not started\",\"unfinished\":\"Remaining items\",\"completed\":\"Completed\",\"pushed\":\"Completed & pushed\"},\n        taskLabels: {\"todo\":\"To do\",\"in_progress\":\"In progress\",\"blocked\":\"Blocked\",\"needs_verification\":\"Needs verification\",\"done\":\"Done\"},\n        unrecordedSummary: 'No progress recorded',\n        noTasksYet: 'No task stats yet',\n        totalsPattern: '{done} of {total} tasks done',\n        sourceAuto: 'Auto-analyzed',\n        btnUpdate: 'Update progress',\n        btnUpdating: 'Analyzing...',\n        btnAdjust: 'Adjust',\n        btnClear: 'Clear',\n        clearTooltip: 'Clear progress and task records now',\n        clearConfirm: 'Clear progress and task records for this session?',\n        clearingFeedback: 'Clearing...',\n        clearedFeedback: '✓ Cleared',\n        clearFailedPrefix: 'Clear failed: ',\n        expandAll: 'Show all',\n        collapse: 'Collapse',\n        remainingHeadingPattern: 'Remaining tasks ({count})',\n        showAllCountPattern: 'Show all {count} ›',\n        collapseArrow: 'Collapse ›',\n        emptyNoTasks: 'Click Update progress to organize tasks for this session',\n        emptyNoRemaining: 'No remaining tasks',\n        completedHeading: 'Completed tasks',\n        countArrowPattern: '{count} ›',\n        notesLabel: 'Notes',\n        addLabel: 'Add',\n        editLabel: 'Edit',\n        untitledTask: 'Untitled task',\n        completedTaskFallback: 'Completed task',\n        viewSource: 'View source',\n        backLabel: '‹ Back',\n        emptyCompleted: 'No completed tasks',\n        editHeading: 'Set session status',\n        progressLabel: 'Progress',\n        clearValueBtn: 'Clear value',\n        notePlaceholder: 'Add next steps or notes...',\n        noteAriaLabel: 'Session notes',\n        sliderAriaLabel: 'Drag to adjust progress',\n        cancelBtn: 'Cancel',\n        saveBtn: 'Save',\n        savingFeedback: 'Saving...',\n        savedFeedback: '✓ Saved',\n        saveFailedPrefix: 'Save failed: ',\n        conflictBanner: 'Save conflict: updated elsewhere. Your draft has been kept.',\n        conflictDetectedFeedback: 'Save failed: revision conflict detected',\n        resolveConflictBtn: 'Load latest & keep draft',\n        conflictRebasedFeedback: 'Synced to latest version. Click Save again to submit your draft.',\n        startingAnalysisFeedback: 'Starting analysis...',\n        analysisNotDonePrefix: 'Analysis incomplete: ',\n        analysisAbnormal: 'execution error',\n        updateFailedPrefix: 'Update failed: ',\n        locatingShort: 'Locating...',\n        locatedJumpMessage: 'Jumped to source message',\n        locateNotFound: 'Source message not found',\n        locateSent: 'Locate request sent',\n        locateHostUnavailable: 'Unable to reach host locate API',\n        locateFailedPrefix: 'Locate failed: ',\n        unknownActionError: 'Unknown error',\n        cardOpFailed: 'Card action failed',\n        cardAuthUnavailable: 'Card authorization unavailable',\n        updateStages: { queued: 'Preparing upgrade', checking: 'Checking version', downloading: 'Downloading update', waiting: 'Waiting for analysis to finish', installing: 'Upgrading' },\n        updateAvailablePattern: 'Update available v{version}',\n        upgradedToPattern: 'Upgraded to v{version}',\n        updateFailedLabel: 'Upgrade failed',\n        upgradeBtn: 'Upgrade',\n        upgradingShort: 'Upgrading...',\n        checkUpdateBtn: 'Check updates',\n        checkingUpdateShort: 'Checking...',\n        alreadyLatestPattern: 'Up to date (v{version})',\n        versionTagPattern: 'v{version}',\n        checkUpdateFailedLabel: 'Update check failed',\n        pleaseWait: 'Please wait',\n        completedShort: 'Done',\n        retryBtn: 'Retry',\n        terminalUpgradePrefix: 'Terminal upgrade: ',\n        reconnectHint: 'Reconnecting to background service; upgrade status will resume shortly',\n        reconnectMcpHint: 'Please reconnect the MCP server in your client',\n      }\n    };\n    const colors = injectedI18n.colors || {\"unstarted\":\"#9098a2\",\"unfinished\":\"#c89b38\",\"completed\":\"#548eea\",\"pushed\":\"#a17be3\"};\n    function getLocale(targetLang) {\n      const code = normalizeLang(targetLang || activeLang);\n      const fromInjected = injectedI18n.locales && injectedI18n.locales[code];\n      if (fromInjected) return fromInjected;\n      if (code === normalizeLang(injectedI18n.lang) && injectedI18n.strings) return injectedI18n.strings;\n      return fallbackLocales[code];\n    }\n    let locale = getLocale(activeLang);\n    let labels = locale.labels || fallbackLocales[activeLang].labels;\n    let taskLabels = locale.taskLabels || fallbackLocales[activeLang].taskLabels;\n    function str(key, vars) {\n      const tmpl = locale[key] !== undefined ? locale[key] : (fallbackLocales[activeLang][key] !== undefined ? fallbackLocales[activeLang][key] : key);\n      if (!vars) return tmpl;\n      return String(tmpl).replace(/\\{(\\w+)\\}/g, function(_, k) { return vars[k] !== undefined ? String(vars[k]) : ''; });\n    }\n    let lastRenderedData = null;\n    const computeUpdateBannerState = window.__agentThingsUpdateBannerState || function(info, dict, opts = {}) {\n      const update = info?.update;\n      const stage = update?.stage;\n      const stages = dict.updateStages || {};\n      const activeStage = Boolean(stages[stage]) || Boolean(opts.starting);\n      const updatedAtMs = update?.updatedAt ? Date.parse(update.updatedAt) : NaN;\n      const completed = stage === 'completed' && Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < 60000;\n      const failed = stage === 'failed';\n      const visible = Boolean(info?.available || activeStage || failed || completed);\n      const command = info?.command || 'npx agent-things@latest';\n      return {\n        visible,\n        active: activeStage,\n        completed,\n        failed,\n        buttonDisabled: activeStage || completed,\n        label: activeStage ? (stages[stage] || stages.queued) : failed ? dict.updateFailedLabel : completed\n          ? str('upgradedToPattern', { version: update?.currentVersion || '' }) : str('updateAvailablePattern', { version: info?.latestVersion || '' }),\n        buttonText: activeStage ? dict.pleaseWait : completed ? dict.completedShort : failed ? dict.retryBtn : dict.upgradeBtn,\n        detail: opts.connectionError ? `${dict.reconnectHint}\\n${dict.terminalUpgradePrefix}${command}`\n          : failed ? `${update?.error || ''}\\n${dict.terminalUpgradePrefix}${command}` : (completed && update?.reconnectMcp ? dict.reconnectMcpHint : ''),\n        versionText: opts.manualCheckStatus === 'failed' ? `${dict.checkUpdateFailedLabel}${opts.checkError ? `: ${opts.checkError}` : ''}`\n          : (opts.manualCheckStatus === 'latest' && info?.currentVersion ? str('alreadyLatestPattern', { version: info.currentVersion }) : (info?.currentVersion ? `v${info.currentVersion}` : '')),\n        showVersionBar: !visible,\n        checking: Boolean(opts.checking),\n        checkDisabled: Boolean(opts.checking),\n        checkFailed: !visible && opts.manualCheckStatus === 'failed',\n        checkButtonText: opts.checking ? dict.checkingUpdateShort : dict.checkUpdateBtn,\n      };\n    };\n    let currentUpdateInfo = null;\n    let updateTimer = null;\n    let manualCheckTimer = null;\n    let updateChecking = false;\n    let upgradeStarting = false;\n    let updateConnectionError = '';\n    let manualCheckStatus = '';\n    let manualCheckError = '';\n    let isSessionAnalyzing = false;\n\n    function applyStaticLanguage() {\n      document.documentElement.lang = activeLang === 'en' ? 'en' : 'zh-CN';\n      const srcEl = document.getElementById('overviewSourceLabel');\n      if (srcEl) srcEl.textContent = str('sourceAuto');\n      const adjustBtn = document.getElementById('btnAdjust');\n      if (adjustBtn) adjustBtn.textContent = str('btnAdjust');\n      const clearBtn = document.getElementById('btnClear');\n      if (clearBtn) clearBtn.setAttribute('aria-label', str('btnClear'));\n      const clearTip = document.getElementById('clearTooltip');\n      if (clearTip) clearTip.textContent = str('clearTooltip');\n      const clearLbl = document.getElementById('clearBtnLabel');\n      if (clearLbl) clearLbl.textContent = str('btnClear');\n      const completedRowLbl = document.getElementById('completedRowLabel');\n      if (completedRowLbl) completedRowLbl.textContent = str('completedHeading');\n      const notesRowLbl = document.getElementById('notesRowLabel');\n      if (notesRowLbl) notesRowLbl.textContent = str('notesLabel');\n      const histHeading = document.getElementById('historyHeading');\n      if (histHeading) histHeading.textContent = str('completedHeading');\n      const histBack = document.getElementById('historyBackBtn');\n      if (histBack) histBack.textContent = str('backLabel');\n      const editHead = document.getElementById('editHeading');\n      if (editHead) editHead.textContent = str('editHeading');\n      const editBack = document.getElementById('editBackBtn');\n      if (editBack) editBack.textContent = str('backLabel');\n      for (const stateKey of ['unstarted', 'unfinished', 'completed', 'pushed']) {\n        const lbl = document.querySelector('#choice-' + stateKey + ' .choice-label');\n        if (lbl && labels[stateKey]) lbl.textContent = labels[stateKey];\n      }\n      const progLbl = document.getElementById('progressFieldLabel');\n      if (progLbl) progLbl.textContent = str('progressLabel');\n      const numIn = document.getElementById('inputProgressNumber');\n      if (numIn) numIn.setAttribute('aria-label', str('progressLabel'));\n      const sliderIn = document.getElementById('inputSlider');\n      if (sliderIn) sliderIn.setAttribute('aria-label', str('sliderAriaLabel'));\n      const clrProgBtn = document.getElementById('btnClearProgress');\n      if (clrProgBtn) clrProgBtn.textContent = str('clearValueBtn');\n      const txtNoteLbl = document.getElementById('txtNoteLabel');\n      if (txtNoteLbl) txtNoteLbl.textContent = str('notesLabel');\n      const txtNoteEl = document.getElementById('txtNote');\n      if (txtNoteEl) {\n        txtNoteEl.placeholder = str('notePlaceholder');\n        txtNoteEl.setAttribute('aria-label', str('noteAriaLabel'));\n      }\n      const conflictEl = document.getElementById('conflictMsg');\n      if (conflictEl) conflictEl.textContent = str('conflictBanner');\n      const resolveBtn = document.getElementById('btnResolveConflict');\n      if (resolveBtn) resolveBtn.textContent = str('resolveConflictBtn');\n      const cancelBtn = document.getElementById('btnCancelEdit');\n      if (cancelBtn) cancelBtn.textContent = str('cancelBtn');\n      const saveBtn = document.getElementById('btnSaveRecord');\n      if (saveBtn) saveBtn.textContent = str('saveBtn');\n      const btnAnalyzeEl = document.getElementById('btnAnalyze');\n      if (btnAnalyzeEl) btnAnalyzeEl.textContent = isSessionAnalyzing ? str('btnUpdating') : str('btnUpdate');\n      renderUpdateUi();\n      const summaryBlock = document.getElementById('summaryBlock');\n      const summaryExpandBtn = document.getElementById('summaryExpand');\n      if (summaryBlock && summaryExpandBtn) {\n        summaryExpandBtn.textContent = summaryBlock.classList.contains('expanded') ? str('collapse') : str('expandAll');\n      }\n      if (!lastRenderedData) {\n        applyCardTitle(currentSessionTitle || str('defaultSessionTitle'), false);\n        const statusLbl = document.getElementById('overviewStatusLabel');\n        if (statusLbl) statusLbl.textContent = labels.unstarted;\n        const totalsEl = document.getElementById('overviewTotals');\n        if (totalsEl) totalsEl.textContent = str('noTasksYet');\n        const sumEl = document.getElementById('overviewSummary');\n        if (sumEl) sumEl.textContent = str('unrecordedSummary');\n        const remHead = document.getElementById('remainingTasksHeading');\n        if (remHead) remHead.textContent = str('remainingHeadingPattern', { count: 0 });\n        const uncompEl = document.getElementById('uncompletedTasksList');\n        if (uncompEl && uncompEl.querySelector('.empty')) {\n          uncompEl.innerHTML = '<div class=\"empty\">' + escapeHtml(str('emptyNoTasks')) + '</div>';\n        }\n        const histCount = document.getElementById('historyCount');\n        if (histCount) histCount.textContent = str('countArrowPattern', { count: 0 });\n        const noteLbl = document.getElementById('noteOpenLabel');\n        if (noteLbl) noteLbl.textContent = str('addLabel');\n        const histList = document.getElementById('historyList');\n        if (histList && histList.querySelector('.empty')) {\n          histList.innerHTML = '<div class=\"empty\">' + escapeHtml(str('emptyCompleted')) + '</div>';\n        }\n      }\n    }\n\n    function setActiveLang(nextLang) {\n      if (nextLang !== 'en' && nextLang !== 'zh') return;\n      const changed = nextLang !== activeLang;\n      activeLang = nextLang;\n      locale = getLocale(activeLang);\n      labels = locale.labels || fallbackLocales[activeLang].labels;\n      taskLabels = locale.taskLabels || fallbackLocales[activeLang].taskLabels;\n      applyStaticLanguage();\n      if (changed && lastRenderedData) {\n        applyFullProgressToUI(lastRenderedData);\n      }\n    }\n\n    function escapeHtml(strVal) {\n      if (strVal === null || strVal === undefined) return '';\n      return String(strVal)\n        .replace(/&/g, '&amp;')\n        .replace(/</g, '&lt;')\n        .replace(/>/g, '&gt;')\n        .replace(/\"/g, '&quot;')\n        .replace(/'/g, '&#39;');\n    }\n    let conversationId = (window.sidecar?.conversationId || new URLSearchParams(window.location.search).get(\"conversationId\") || \"\").trim();\n    window.conversationId = conversationId;\n    const connection = {\"origin\":\"http://127.0.0.1:29888\",\"conversationId\":conversationId,\"title\":str('defaultSessionTitle'),\"loadToken\":null};\n    let currentSessionTitle = '';\n\n    function isGenericTitle(val) {\n      const text = String(val || '').trim();\n      return !text ||\n        text === '当前会话' ||\n        text === 'Agent Things 会话任务进度' ||\n        text === 'Current session' ||\n        text === 'Agent Things Progress' ||\n        text === str('defaultSessionTitle') ||\n        text === str('defaultDocTitle');\n    }\n\n    function applyCardTitle(nextTitle, remember = true) {\n      const clean = String(nextTitle || '').trim();\n      if (remember && !isGenericTitle(clean)) {\n        currentSessionTitle = clean;\n      }\n      const display = !isGenericTitle(clean)\n        ? clean\n        : (!isGenericTitle(currentSessionTitle) ? currentSessionTitle : str('defaultSessionTitle'));\n      const titleEl = document.getElementById('cardTitle');\n      if (titleEl) {\n        titleEl.textContent = display;\n        titleEl.title = display;\n      }\n      document.title = display + ' · ' + str('docTitleSuffix');\n    }\n    let currentRevision = 0;\n    let savedRevision = 0;\n    let draftBaseRevision = savedRevision;\n    let isFormDirty = false;\n    let pendingRemotePayload = null;\n    let snapshotFetchSeq = 0;\n    let currentState = \"unstarted\";\n    let currentProgress = null;\n    let isDraggingSlider = false;\n    let hostChannelPort = null;\n\n    function resetScroll() {\n      const panel = document.getElementById('panelBody');\n      const shell = document.getElementById('agentThingsCard');\n      if (panel) panel.scrollTop = 0;\n      if (shell) shell.classList.remove('is-scrolled');\n    }\n\n    function showConflictNotice(msg) {\n      const box = document.getElementById('conflictBox');\n      const text = document.getElementById('conflictMsg');\n      if (box && text) {\n        text.textContent = msg || str('conflictBanner');\n        box.style.display = 'block';\n      }\n      showFeedback(str('conflictDetectedFeedback'), true);\n    }\n\n    function hideConflictNotice() {\n      const box = document.getElementById('conflictBox');\n      if (box) box.style.display = 'none';\n    }\n\n    function resolveConflictKeepDraft() {\n      draftBaseRevision = savedRevision;\n      hideConflictNotice();\n      showFeedback(str('conflictRebasedFeedback'));\n      if (conversationId) {\n        void fetchSessionSnapshot(conversationId, { rebaseDraftRevision: true });\n      }\n    }\n\n    function switchToEdit() {\n      resetScroll();\n      draftBaseRevision = savedRevision;\n      isFormDirty = false;\n      hideConflictNotice();\n      document.getElementById('overviewView').hidden = true;\n      document.getElementById('historyView').hidden = true;\n      document.getElementById('editView').hidden = false;\n      clearFeedback();\n    }\n\n    function switchToEditNote() {\n      switchToEdit();\n      setTimeout(function() {\n        const txt = document.getElementById('txtNote');\n        if (txt) txt.focus();\n      }, 50);\n    }\n\n    function switchToHistory() {\n      resetScroll();\n      document.getElementById('overviewView').hidden = true;\n      document.getElementById('editView').hidden = true;\n      document.getElementById('historyView').hidden = false;\n      clearFeedback();\n    }\n\n    function switchToOverview() {\n      resetScroll();\n      document.getElementById('editView').hidden = true;\n      document.getElementById('historyView').hidden = true;\n      document.getElementById('overviewView').hidden = false;\n      isFormDirty = false;\n      hideConflictNotice();\n      clearFeedback();\n      if (pendingRemotePayload) {\n        const nextPayload = pendingRemotePayload;\n        pendingRemotePayload = null;\n        handleRemoteSessionUpdate(nextPayload);\n      }\n      checkSummaryOverflow();\n    }\n\n    function markFormDirty() {\n      isFormDirty = true;\n    }\n\n    function selectState(stateKey, isRemoteSync = false) {\n      if (!isRemoteSync) markFormDirty();\n      currentState = stateKey;\n      for (const key of Object.keys(labels)) {\n        const btn = document.getElementById('choice-' + key);\n        if (btn) btn.setAttribute('aria-pressed', String(key === stateKey));\n      }\n      if (!isRemoteSync) {\n        if (stateKey === 'unstarted') {\n          updateProgressVal(0);\n        } else if (stateKey === 'completed' || stateKey === 'pushed') {\n          updateProgressVal(100);\n        }\n      }\n      updateRangeMark(colors[stateKey] || colors.unfinished);\n    }\n\n    function onNumberInput(val) {\n      markFormDirty();\n      const num = val === '' ? null : Number(val);\n      if (num !== null && !isNaN(num)) {\n        const clamped = Math.max(0, Math.min(100, Math.round(num)));\n        updateProgressVal(clamped);\n        const nextState = clamped === 100 ? (currentState === 'pushed' ? 'pushed' : 'completed')\n          : (clamped === 0 && currentState === 'unstarted' ? 'unstarted' : 'unfinished');\n        selectState(nextState);\n      } else {\n        updateProgressVal(null);\n      }\n    }\n\n    function onProgressKeyDown(event) {\n      if (event.key === 'Enter') {\n        event.preventDefault();\n        onSaveRecord();\n      }\n    }\n\n    function onSliderPointerDown() {\n      isDraggingSlider = true;\n      const rangeBox = document.getElementById('rangeBox');\n      if (rangeBox) rangeBox.classList.add('is-dragging');\n    }\n\n    function onSliderPointerUp() {\n      isDraggingSlider = false;\n      const rangeBox = document.getElementById('rangeBox');\n      if (rangeBox) rangeBox.classList.remove('is-dragging');\n    }\n\n    function onSliderInput(val) {\n      markFormDirty();\n      const value = Number(val);\n      const nearest = Math.round(value / 25) * 25;\n      const snapped = (isDraggingSlider && Math.abs(value - nearest) <= 2) ? nearest : value;\n      updateProgressVal(snapped);\n      const nextState = snapped === 100 ? (currentState === 'pushed' ? 'pushed' : 'completed')\n        : (snapped === 0 && currentState === 'unstarted' ? 'unstarted' : 'unfinished');\n      selectState(nextState);\n    }\n\n    function onClearProgressClick() {\n      updateProgressVal(null);\n    }\n\n    function updateProgressVal(val) {\n      currentProgress = val;\n      const slider = document.getElementById('inputSlider');\n      const numberInput = document.getElementById('inputProgressNumber');\n      const rangeBox = document.getElementById('rangeBox');\n      if (slider) slider.value = val !== null ? val : 0;\n      if (numberInput) numberInput.value = val !== null ? val : '';\n      if (rangeBox) rangeBox.style.setProperty('--fill', (val !== null ? val : 0) + '%');\n    }\n\n    function updateRangeMark(markColor) {\n      const rangeBox = document.getElementById('rangeBox');\n      if (rangeBox) rangeBox.style.setProperty('--mark', markColor);\n    }\n\n    function toggleAllRemaining() {\n      const hiddenRows = document.querySelectorAll('.remaining-hidden');\n      const btn = document.getElementById('btnToggleAllRemaining');\n      const isExpanded = btn?.getAttribute('data-expanded') === 'true';\n      hiddenRows.forEach(function(row) { row.hidden = isExpanded; });\n      if (btn) {\n        btn.setAttribute('data-expanded', String(!isExpanded));\n        const total = hiddenRows.length + 3;\n        btn.textContent = isExpanded ? str('showAllCountPattern', { count: total }) : str('collapseArrow');\n      }\n    }\n\n    function toggleSummaryExpand() {\n      const block = document.getElementById('summaryBlock');\n      const btn = document.getElementById('summaryExpand');\n      if (!block || !btn) return;\n      const isExpanded = block.classList.toggle('expanded');\n      btn.textContent = isExpanded ? str('collapse') : str('expandAll');\n    }\n\n    function checkSummaryOverflow() {\n      const summaryEl = document.getElementById('overviewSummary');\n      const btn = document.getElementById('summaryExpand');\n      if (summaryEl && btn) {\n        btn.hidden = summaryEl.scrollHeight <= summaryEl.clientHeight + 2;\n      }\n    }\n\n    async function onSourceClick(button) {\n      if (!button || button.disabled) return;\n      const originalLabel = button.textContent || str('viewSource');\n      try {\n        const sourceJson = button.getAttribute('data-source');\n        if (!sourceJson) return;\n        const source = JSON.parse(sourceJson);\n        button.disabled = true;\n        button.textContent = str('locatingShort');\n\n        // 1. 优先通过 Sidecar 后台 /api/locate 直达宿主 CDP，等待真实跳转与定位结果\n        let locateHandled = false;\n        try {\n          const resp = await fetch('/api/locate', {\n            method: 'POST',\n            headers: { 'Content-Type': 'application/json' },\n            body: JSON.stringify({ conversationId, source }),\n          });\n          const data = await resp.json().catch(() => null);\n          if (resp.ok && data) {\n            locateHandled = true;\n            if (data.located) {\n              showFeedback(data.message || str('locatedJumpMessage'));\n              return;\n            }\n            showFeedback(data.message || str('locateNotFound'), true);\n            return;\n          }\n        } catch (_) {}\n\n        // 2. Sidecar HTTP 不可用时降级到 Port / Parent 消息通道\n        if (!locateHandled) {\n          let posted = false;\n          if (hostChannelPort) {\n            try {\n              hostChannelPort.postMessage({\n                type: 'AGENT_THINGS_LOCATE',\n                conversationId,\n                source,\n              });\n              posted = true;\n            } catch (_) {}\n          }\n          if (window.parent && window.parent !== window) {\n            try {\n              window.parent.postMessage({\n                type: 'AGENT_THINGS_LOCATE',\n                conversationId,\n                source,\n              }, '*');\n              posted = true;\n            } catch (_) {}\n          }\n          if (posted) {\n            showFeedback(str('locateSent'));\n            return;\n          }\n        }\n\n        showFeedback(str('locateHostUnavailable'), true);\n      } catch (err) {\n        showFeedback(str('locateFailedPrefix') + (err.message || str('unknownActionError')), true);\n      } finally {\n        button.disabled = false;\n        button.textContent = str('viewSource') || originalLabel;\n      }\n    }\n\n    let feedbackTimerId = null;\n\n    function showFeedback(msg, isError = false) {\n      const el = document.getElementById('feedbackMsg');\n      if (!el) return;\n      if (feedbackTimerId) {\n        clearTimeout(feedbackTimerId);\n        feedbackTimerId = null;\n      }\n      el.textContent = msg;\n      el.className = 'feedback-msg ' + (isError ? 'error' : 'success');\n      feedbackTimerId = setTimeout(function() {\n        feedbackTimerId = null;\n        if (el.textContent === msg) el.textContent = '';\n      }, 4000);\n    }\n\n    function clearFeedback() {\n      if (feedbackTimerId) {\n        clearTimeout(feedbackTimerId);\n        feedbackTimerId = null;\n      }\n      const el = document.getElementById('feedbackMsg');\n      if (el) el.textContent = '';\n    }\n\n    let sseSource = null;\n    let sseReconnectTimer = null;\n    let authTicket = null;\n    let serviceOrigin = connection?.origin || null;\n    const pendingActions = new Map();\n\n    async function sendProxyAction(action, payload = {}) {\n      const res = await fetch('/api/action', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          conversationId: conversationId,\n          action: action,\n          payload: payload,\n        })\n      });\n      const data = await res.json();\n      if (!res.ok || data.error) throw new Error(data.error || str('cardOpFailed'));\n      return data;\n    }\n\n    function onIncomingHostMessage(data) {\n      if (!data || typeof data !== 'object') return;\n\n      if (data.type === 'AGENT_THINGS_AUTH_RESPONSE' && data.nonce) {\n        const req = pendingActions.get(data.nonce);\n        if (req) {\n          clearTimeout(req.timer);\n          pendingActions.delete(data.nonce);\n          if (data.origin) serviceOrigin = data.origin;\n          req.resolve(data);\n        }\n        return;\n      }\n\n      if (data.type === 'AGENT_THINGS_ACTION_RESULT' && data.nonce) {\n        const req = pendingActions.get(data.nonce);\n        if (req) {\n          clearTimeout(req.timer);\n          pendingActions.delete(data.nonce);\n          if (data.success) {\n            req.resolve(data.data || {});\n          } else {\n            req.reject(new Error(data.error || str('cardOpFailed')));\n          }\n        }\n        return;\n      }\n    }\n\n    async function requestHostAuth() {\n      try {\n        const res = await fetch('/api/ticket?conversationId=' + encodeURIComponent(conversationId));\n        if (!res.ok) throw new Error(str('cardAuthUnavailable'));\n        return await res.json();\n      } catch (err) {\n        const prefix = activeLang === 'en' ? 'Failed to request event ticket: ' : '申请订阅票据失败: ';\n        throw new Error(prefix + err.message);\n      }\n    }\n\n    window.addEventListener('message', (event) => {\n      try {\n        onIncomingHostMessage(event.data);\n      } catch (_) {}\n    });\n\n    async function onSaveRecord() {\n      const btn = document.getElementById('btnSaveRecord');\n      const noteVal = document.getElementById('txtNote')?.value ?? '';\n      try {\n        if (btn) btn.disabled = true;\n        showFeedback(str('savingFeedback'));\n        const reply = await sendProxyAction('update', {\n          expectedRevision: draftBaseRevision,\n          record: {\n            state: currentState,\n            progress: currentProgress,\n            note: noteVal\n          }\n        });\n        // 修复：sendProxyAction 已解包 data，调用方应读 reply.session.recordRevision\n        const newRev = reply?.session?.recordRevision;\n        if (typeof newRev === 'number') {\n          savedRevision = newRev;\n          draftBaseRevision = newRev;\n          currentRevision = newRev;\n        }\n        isFormDirty = false;\n        hideConflictNotice();\n        showFeedback(str('savedFeedback'));\n        setTimeout(switchToOverview, 600);\n      } catch (err) {\n        const isConflict = err.message && (err.message.includes('其他窗口更新') || err.message.includes('版本已被') || err.message.includes('updated by another') || err.message.includes('409') || err.message.includes('conflict') || err.message.includes('revision mismatch'));\n        if (isConflict) {\n          showConflictNotice(str('conflictBanner'));\n        } else {\n          showFeedback(str('saveFailedPrefix') + err.message, true);\n        }\n      } finally {\n        if (btn) btn.disabled = false;\n      }\n    }\n\n    async function onClearClick() {\n      if (!confirm(str('clearConfirm'))) return;\n      try {\n        showFeedback(str('clearingFeedback'));\n        const reply = await sendProxyAction('clear', {\n          expectedRevision: draftBaseRevision,\n        });\n        const newRev = reply?.session?.recordRevision;\n        if (typeof newRev === 'number') {\n          savedRevision = newRev;\n          draftBaseRevision = newRev;\n          currentRevision = newRev;\n        }\n        isFormDirty = false;\n        hideConflictNotice();\n        showFeedback(str('clearedFeedback'));\n      } catch (err) {\n        showFeedback(str('clearFailedPrefix') + err.message, true);\n      }\n    }\n\n    function handleRemoteSessionUpdate(payload, opts) {\n      if (!payload) return;\n      const s = payload.session || payload;\n      const incomingId = s && s.conversationId ? String(s.conversationId).trim() : '';\n      if (incomingId && conversationId && incomingId !== conversationId) return;\n      if (payload.lang) setActiveLang(payload.lang);\n      if (s && s.lang) setActiveLang(s.lang);\n      const effectiveProgress = typeof s.progress === 'number' ? s.progress : typeof s.progress?.progress === 'number' ? s.progress.progress : (typeof s === 'number' ? s : null);\n      const effectiveState = s.state || s.progress?.state || (effectiveProgress === 100 ? 'completed' : (effectiveProgress > 0 ? 'unfinished' : 'unstarted'));\n      const effectiveTasks = Array.isArray(s.tasks) ? s.tasks : (Array.isArray(s.progress?.tasks) ? s.progress.tasks : (s.analysis?.ledger?.tasks || []));\n      const effectiveNote = s.note || s.progress?.note || '';\n      const effectiveSummary = s.summary || s.progress?.summary || s.analysis?.ledger?.summary || '';\n      const effectiveTitle = !isGenericTitle(s.title)\n        ? String(s.title).trim()\n        : (!isGenericTitle(s.progress?.title) ? String(s.progress.title).trim() : currentSessionTitle);\n\n      if (typeof s.recordRevision === 'number') savedRevision = Math.max(savedRevision, s.recordRevision);\n      else if (typeof s.progress?.revision === 'number') savedRevision = Math.max(savedRevision, s.progress.revision);\n      else if (typeof s.revision === 'number') savedRevision = Math.max(savedRevision, s.revision);\n\n      if (opts?.rebaseDraftRevision) {\n        draftBaseRevision = savedRevision;\n      }\n\n      // 若未处于草稿编辑中，基准版本与当前展示版本同步更新\n      if (!isFormDirty) {\n        pendingRemotePayload = null;\n        currentRevision = savedRevision;\n        draftBaseRevision = savedRevision;\n      } else {\n        pendingRemotePayload = payload;\n      }\n\n      const analyzing = Boolean(s.analyzing || s.analysisStatus?.status === 'pending');\n      isSessionAnalyzing = analyzing;\n      const analysisStatus = s.analysisStatus;\n      const btnAnalyze = document.getElementById('btnAnalyze');\n      if (btnAnalyze) {\n        if (analyzing) {\n          btnAnalyze.disabled = true;\n          btnAnalyze.textContent = str('btnUpdating');\n        } else {\n          btnAnalyze.disabled = ['waiting', 'installing'].includes(currentUpdateInfo?.update?.stage);\n          btnAnalyze.textContent = str('btnUpdate');\n          if (analysisStatus?.status === 'failed') {\n            showFeedback(str('analysisNotDonePrefix') + (analysisStatus.error || str('analysisAbnormal')), true);\n          }\n        }\n      }\n\n      // 仅在非 dirty 编辑态下将远端状态刷入表单与展示\n      if (!isFormDirty) {\n        applyFullProgressToUI({\n          state: effectiveState,\n          progress: effectiveProgress,\n          tasks: effectiveTasks,\n          note: effectiveNote,\n          summary: effectiveSummary,\n          title: effectiveTitle,\n          revision: currentRevision,\n          updatedAt: s.updatedAt || s.progress?.updatedAt,\n        });\n      }\n    }\n\n    function applyFullProgressToUI(data) {\n      if (!data) return;\n      lastRenderedData = data;\n      currentRevision = data.revision ?? currentRevision;\n      const nextState = data.state || (data.progress === 100 ? 'completed' : data.progress > 0 ? 'unfinished' : 'unstarted');\n      const nextProgress = data.progress ?? null;\n\n      if (!isFormDirty) {\n        currentState = nextState;\n        currentProgress = nextProgress;\n        updateProgressVal(currentProgress);\n        selectState(currentState, true);\n        const noteInput = document.getElementById('txtNote');\n        if (noteInput) noteInput.value = data.note || '';\n        const noteOpenLabel = document.getElementById('noteOpenLabel');\n        if (noteOpenLabel) noteOpenLabel.textContent = data.note ? str('editLabel') : str('addLabel');\n      }\n\n      applyCardTitle(data.title);\n\n      const scoreEl = document.getElementById('overviewScoreNumber');\n      if (scoreEl) scoreEl.textContent = currentProgress !== null ? currentProgress : '—';\n      const scoreUnit = document.querySelector('.score-unit');\n      if (scoreUnit) scoreUnit.hidden = currentProgress === null;\n\n      const labelEl = document.getElementById('overviewStatusLabel');\n      if (labelEl) labelEl.textContent = labels[currentState] || currentState;\n      const dotEl = document.getElementById('overviewDot');\n      if (dotEl) {\n        dotEl.style.borderColor = colors[currentState] || colors.unstarted;\n        dotEl.style.background = 'transparent';\n      }\n\n      const timeEl = document.getElementById('overviewTimestamp');\n      if (timeEl) {\n        const rawTime = data.updatedAt || data.progress?.updatedAt;\n        if (rawTime) {\n          const d = new Date(rawTime);\n          if (!isNaN(d.getTime())) {\n            const m = d.getMonth() + 1;\n            const day = d.getDate();\n            const h = String(d.getHours()).padStart(2, '0');\n            const min = String(d.getMinutes()).padStart(2, '0');\n            timeEl.textContent = `${m}/${day} ${h}:${min}`;\n          } else {\n            timeEl.textContent = '--/-- --:--';\n          }\n        } else {\n          timeEl.textContent = '--/-- --:--';\n        }\n      }\n\n      const meterEl = document.getElementById('overviewMeter');\n      if (meterEl) {\n        const prog = currentProgress != null ? Math.max(0, Math.min(100, currentProgress)) : 0;\n        meterEl.style.setProperty('--fill', prog + '%');\n        meterEl.style.setProperty('--mark', colors[currentState] || colors.unstarted);\n      }\n\n      const totalCount = data.totalTasks ?? data.tasks?.length ?? 0;\n      const doneCount = data.completedTasks ?? data.tasks?.filter(function(t) { return t.status === 'done'; }).length ?? 0;\n      const totalsEl = document.getElementById('overviewTotals');\n      if (totalsEl) {\n        totalsEl.textContent = totalCount > 0 ? str('totalsPattern', { done: doneCount, total: totalCount }) : str('noTasksYet');\n      }\n\n      const summaryText = data.summary || data.note || '';\n      const summaryEl = document.getElementById('overviewSummary');\n      if (summaryEl) {\n        summaryEl.textContent = summaryText || str('unrecordedSummary');\n      }\n      checkSummaryOverflow();\n\n      const titleProgress = document.getElementById('titleProgress');\n      if (titleProgress) {\n        const color = colors[currentState] || colors.unstarted;\n        const hasProgress = currentProgress !== null && currentProgress !== undefined && Number.isFinite(currentProgress);\n        const progVal = hasProgress ? Math.max(0, Math.min(100, currentProgress)) : 0;\n        const ringSig = currentState + ':' + (hasProgress ? progVal : 'null');\n        if (titleProgress.dataset.ringSig !== ringSig) {\n          titleProgress.dataset.ringSig = ringSig;\n          let piePath = '';\n          if (hasProgress && progVal > 0) {\n            const angle = (progVal / 100) * Math.PI * 2;\n            const x = (12 + 7.4 * Math.sin(angle)).toFixed(2);\n            const y = (12 - 7.4 * Math.cos(angle)).toFixed(2);\n            piePath = progVal === 100\n              ? '<path d=\"M12 4.6a7.4 7.4 0 1 1 0 14.8a7.4 7.4 0 1 1 0-14.8\" fill=\"' + color + '\" class=\"progress-pie\"/>'\n              : '<path d=\"M12 12L12 4.6A7.4 7.4 0 ' + (progVal > 50 ? 1 : 0) + ' 1 ' + x + ' ' + y + 'Z\" fill=\"' + color + '\" class=\"progress-pie\"/>';\n          }\n\n          const isHundred = progVal === 100;\n          const fontSize = isHundred ? '5.8px' : '6.4px';\n          const letterSpacing = isHundred ? '-0.3px' : '-0.2px';\n\n          titleProgress.innerHTML = '<svg viewBox=\"0 0 24 24\" width=\"32\" height=\"32\" aria-hidden=\"true\" style=\"overflow:visible\">' +\n            '<circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"none\" stroke=\"' + color + '\" stroke-width=\"1.6\" opacity=\"' + (hasProgress ? '1' : '0.85') + '\"/>' +\n            piePath +\n            '<text x=\"12\" y=\"12.4\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"' + color + '\" class=\"' + (hasProgress ? '' : 'progress-unknown') + '\" style=\"font:600 ' + fontSize + ' -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:' + letterSpacing + ';font-variant-numeric:tabular-nums\">' + (hasProgress ? (progVal + '%') : '—') + '</text>' +\n            '</svg>';\n        }\n      }\n\n      if (Array.isArray(data.tasks)) {\n        const remaining = data.tasks.filter(function(t) { return t.status !== 'done'; });\n        const completed = data.tasks.filter(function(t) { return t.status === 'done'; });\n\n        const remainingHeading = document.getElementById('remainingTasksHeading');\n        if (remainingHeading) remainingHeading.textContent = str('remainingHeadingPattern', { count: remaining.length });\n\n        const toggleBtn = document.getElementById('btnToggleAllRemaining');\n        if (toggleBtn) {\n          toggleBtn.hidden = remaining.length <= 3;\n          toggleBtn.textContent = str('showAllCountPattern', { count: remaining.length });\n          toggleBtn.setAttribute('data-expanded', 'false');\n        }\n\n        const historyCount = document.getElementById('historyCount');\n        if (historyCount) historyCount.textContent = str('countArrowPattern', { count: completed.length });\n\n        const uncompletedList = document.getElementById('uncompletedTasksList');\n        const remSig = activeLang + '|' + JSON.stringify(remaining.map(function(t) { return [t.id, t.status, t.title, t.summary, t.source]; }));\n        if (uncompletedList && uncompletedList.dataset.tasksSig !== remSig) {\n          uncompletedList.dataset.tasksSig = remSig;\n          let html = '';\n          if (data.tasks.length === 0) {\n            html = '<div class=\"empty\">' + escapeHtml(str('emptyNoTasks')) + '</div>';\n          } else if (remaining.length === 0) {\n            html = '<div class=\"empty\">' + escapeHtml(str('emptyNoRemaining')) + '</div>';\n          }\n          html += remaining.map(function(task, idx) {\n            const hasSource = task.source && task.source.locator;\n            const badge = taskLabels[task.status] || task.status;\n            return '<div class=\"task-row ' + (idx >= 3 ? 'remaining-hidden' : '') + '\" data-status=\"' + escapeHtml(task.status) + '\" ' + (hasSource ? 'tabindex=\"0\" ' : '') + (idx >= 3 ? 'hidden' : '') + '>' +\n              '<span class=\"task-dot\"></span>' +\n              '<div class=\"task-content\">' +\n                '<div class=\"task-title\">' + escapeHtml(task.title || task.summary || str('untitledTask')) + '</div>' +\n                '<div class=\"task-meta\">' + escapeHtml(badge) + '</div>' +\n              '</div>' +\n              (hasSource ? '<div class=\"task-source\"><button type=\"button\" data-source=\"' + escapeHtml(JSON.stringify(task.source)) + '\" onclick=\"onSourceClick(this)\">' + escapeHtml(str('viewSource')) + '</button></div>' : '') +\n            '</div>';\n          }).join('');\n          uncompletedList.innerHTML = html;\n        }\n\n        const historyList = document.getElementById('historyList');\n        const histSig = activeLang + '|' + JSON.stringify(completed.map(function(t) { return [t.id, t.title, t.summary, t.source]; }));\n        if (historyList && historyList.dataset.tasksSig !== histSig) {\n          historyList.dataset.tasksSig = histSig;\n          let html = '';\n          if (completed.length === 0) {\n            html = '<div class=\"empty\">' + escapeHtml(str('emptyCompleted')) + '</div>';\n          }\n          html += completed.map(function(task, idx) {\n            const hasSource = task.source && task.source.locator;\n            return '<div class=\"task-row\" data-status=\"done\"' + (hasSource ? ' tabindex=\"0\"' : '') + '>' +\n              '<span class=\"task-dot\"></span>' +\n              '<div class=\"task-content\">' +\n                '<div class=\"task-title\">' + escapeHtml(task.title || task.summary || str('completedTaskFallback')) + '</div>' +\n                '<div class=\"task-meta\">' + escapeHtml(taskLabels.done || str('completedShort')) + '</div>' +\n              '</div>' +\n              (hasSource ? '<div class=\"task-source\"><button type=\"button\" data-source=\"' + escapeHtml(JSON.stringify(task.source)) + '\" onclick=\"onSourceClick(this)\">' + escapeHtml(str('viewSource')) + '</button></div>' : '') +\n            '</div>';\n          }).join('');\n          historyList.innerHTML = html;\n        }\n      }\n\n      if (hostChannelPort) {\n        try {\n          hostChannelPort.postMessage({\n            type: 'AGENT_THINGS_CARD_UPDATED',\n            conversationId: conversationId,\n            progress: currentProgress,\n            revision: currentRevision,\n            state: currentState,\n          });\n        } catch (_) {}\n      }\n    }\n\n    async function onAnalyzeClick() {\n      const btn = document.getElementById('btnAnalyze');\n      try {\n        if (btn) {\n          btn.disabled = true;\n          btn.textContent = str('btnUpdating');\n        }\n        showFeedback(str('startingAnalysisFeedback'));\n        await sendProxyAction('analyze', {});\n      } catch (err) {\n        showFeedback(str('updateFailedPrefix') + err.message, true);\n        if (btn) {\n          btn.disabled = false;\n          btn.textContent = str('btnUpdate');\n        }\n      }\n    }\n\n    async function initEventStream() {\n      if (sseReconnectTimer) {\n        clearTimeout(sseReconnectTimer);\n        sseReconnectTimer = null;\n      }\n      if (sseSource) {\n        try { sseSource.close(); } catch (_) {}\n        sseSource = null;\n      }\n\n      try {\n        const auth = await requestHostAuth();\n        if (!auth?.ticket || !auth?.origin) {\n          scheduleReconnect();\n          return;\n        }\n        authTicket = auth.ticket;\n        serviceOrigin = auth.origin;\n\n        const sseUrl = auth.origin + '/session/events?id=' + encodeURIComponent(conversationId) + '&ticket=' + encodeURIComponent(auth.ticket);\n        const es = new EventSource(sseUrl);\n        sseSource = es;\n\n        es.addEventListener('snapshot', function(ev) {\n          try {\n            const data = JSON.parse(ev.data);\n            handleRemoteSessionUpdate(data);\n          } catch (_) {}\n        });\n\n        es.addEventListener('change', function(ev) {\n          try {\n            const data = JSON.parse(ev.data);\n            handleRemoteSessionUpdate(data);\n          } catch (_) {}\n        });\n\n        es.onerror = function() {\n          try { es.close(); } catch (_) {}\n          sseSource = null;\n          scheduleReconnect();\n        };\n      } catch (_) {\n        scheduleReconnect();\n      }\n    }\n\n    function scheduleReconnect() {\n      if (sseReconnectTimer) return;\n      sseReconnectTimer = setTimeout(function() {\n        sseReconnectTimer = null;\n        initEventStream();\n      }, 2000);\n    }\n\n    function setupScrollListener() {\n      const panel = document.getElementById('panelBody');\n      const shell = document.getElementById('agentThingsCard');\n      if (!panel || !shell) return;\n      panel.addEventListener('scroll', function() {\n        const isScrolled = panel.scrollTop > 8;\n        shell.classList.toggle('is-scrolled', isScrolled);\n      }, { passive: true });\n    }\n\n    function resetToEmptySession(nextTitle) {\n      isFormDirty = false;\n      pendingRemotePayload = null;\n      savedRevision = 0;\n      draftBaseRevision = 0;\n      currentRevision = 0;\n      hideConflictNotice();\n      if (nextTitle !== undefined && !isGenericTitle(nextTitle)) {\n        currentSessionTitle = String(nextTitle).trim();\n      } else if (nextTitle === '') {\n        currentSessionTitle = '';\n      }\n      applyFullProgressToUI({\n        state: 'unstarted',\n        progress: null,\n        tasks: [],\n        note: '',\n        summary: str('unrecordedSummary'),\n        title: currentSessionTitle || str('defaultSessionTitle'),\n        revision: 0,\n        updatedAt: null,\n      });\n      const noteInput = document.getElementById('txtNote');\n      if (noteInput) noteInput.value = '';\n    }\n\n    function switchConversation(newId, incomingTitle) {\n      const cleanId = (newId || '').trim();\n      if (!cleanId) return;\n      if (cleanId === conversationId) {\n        if (!isGenericTitle(incomingTitle)) applyCardTitle(incomingTitle);\n        return;\n      }\n      conversationId = cleanId;\n      window.conversationId = cleanId;\n      currentSessionTitle = !isGenericTitle(incomingTitle) ? String(incomingTitle).trim() : '';\n      resetToEmptySession(currentSessionTitle);\n      if (sseSource) {\n        try { sseSource.close(); } catch (_) {}\n        sseSource = null;\n      }\n      fetchSessionSnapshot(conversationId);\n      initEventStream();\n    }\n\n    window.addEventListener('message', (ev) => {\n      if (window.parent && window.parent !== window && ev.source != null && ev.source !== window.parent) return;\n      if (ev.data?.type === 'theme-change') {\n        syncThemeWithHost();\n        requestAnimationFrame(syncThemeWithHost);\n      }\n      if (ev.data?.type === 'dsh-lang-sync' && ev.data?.lang) {\n        setActiveLang(ev.data.lang);\n      }\n      if (ev.data?.type === 'ANTIGRAVITY_CONVERSATION_CHANGED' || ev.data?.type === 'conversation-change') {\n        const newId = (ev.data?.conversationId || ev.data?.id || '').trim();\n        const incomingTitle = typeof ev.data?.title === 'string' ? ev.data.title.trim() : '';\n        if (newId) {\n          switchConversation(newId, incomingTitle);\n        } else if (ev.data?.type === 'conversation-change' && ev.data?.allowEmpty) {\n          snapshotFetchSeq++;\n          conversationId = '';\n          window.conversationId = '';\n          if (sseSource) {\n            try { sseSource.close(); } catch (_) {}\n            sseSource = null;\n          }\n          resetToEmptySession('');\n        }\n      }\n    });\n\n    async function fetchSessionSnapshot(convId, opts) {\n      const targetId = convId || conversationId;\n      if (!targetId) return;\n      const fetchSeq = ++snapshotFetchSeq;\n      try {\n        const res = await fetch('/api/session?conversationId=' + encodeURIComponent(targetId));\n        if (fetchSeq !== snapshotFetchSeq || targetId !== conversationId) return;\n        if (res.ok) {\n          const data = await res.json();\n          if (fetchSeq !== snapshotFetchSeq || targetId !== conversationId) return;\n          if (data?.lang) setActiveLang(data.lang);\n          if (data && data.session) {\n            const mergedTitle = !isGenericTitle(data.session.title) ? data.session.title : data.title;\n            handleRemoteSessionUpdate({ ...data.session, title: mergedTitle, lang: data.lang || data.session.lang }, opts);\n          } else if (!opts?.rebaseDraftRevision) {\n            resetToEmptySession(data?.title);\n          }\n        } else if (!opts?.rebaseDraftRevision) {\n          resetToEmptySession();\n        }\n      } catch (_) {\n        if (fetchSeq !== snapshotFetchSeq || targetId !== conversationId) return;\n        if (!opts?.rebaseDraftRevision) resetToEmptySession();\n      }\n    }\n\n    function renderUpdateUi(info) {\n      if (info !== undefined) currentUpdateInfo = info;\n      const banner = computeUpdateBannerState(currentUpdateInfo, locale, {\n        starting: upgradeStarting,\n        checking: updateChecking,\n        connectionError: updateConnectionError,\n        manualCheckStatus,\n        checkError: manualCheckError,\n      });\n      const box = document.getElementById('appUpdateBox');\n      const labelEl = document.getElementById('appUpdateLabel');\n      const upgradeEl = document.getElementById('btnAppUpdate');\n      const detailEl = document.getElementById('appUpdateDetail');\n      const versionBarEl = document.getElementById('versionBar');\n      const versionTextEl = document.getElementById('versionBarText');\n      const checkBtnEl = document.getElementById('btnCheckUpdate');\n      if (box) {\n        box.hidden = !banner.visible;\n        box.setAttribute('data-failed', String(banner.failed));\n      }\n      if (labelEl) labelEl.textContent = banner.label;\n      if (upgradeEl) {\n        upgradeEl.textContent = banner.buttonText;\n        upgradeEl.disabled = banner.buttonDisabled;\n      }\n      if (detailEl) {\n        detailEl.textContent = banner.detail;\n        detailEl.hidden = !banner.detail;\n      }\n      if (versionBarEl) {\n        versionBarEl.hidden = !(banner.showVersionBar && (currentUpdateInfo || banner.checking || banner.checkFailed));\n        versionBarEl.setAttribute('data-failed', String(banner.checkFailed));\n      }\n      if (versionTextEl) versionTextEl.textContent = banner.versionText;\n      if (checkBtnEl) {\n        checkBtnEl.hidden = banner.showCheckButton === false || Boolean(currentUpdateInfo?.unsupported);\n        checkBtnEl.textContent = banner.checkButtonText;\n        checkBtnEl.disabled = banner.checkDisabled;\n      }\n      const btnAnalyze = document.getElementById('btnAnalyze');\n      if (btnAnalyze) {\n        btnAnalyze.disabled = isSessionAnalyzing || ['waiting', 'installing'].includes(currentUpdateInfo?.update?.stage);\n      }\n      return banner.active;\n    }\n\n    async function pollAppUpdate() {\n      if (updateTimer) {\n        clearTimeout(updateTimer);\n        updateTimer = null;\n      }\n      try {\n        const reply = await sendProxyAction('app-update-info', {});\n        const info = reply?.updateInfo ?? null;\n        updateConnectionError = '';\n        if (info?.available) {\n          manualCheckStatus = '';\n          manualCheckError = '';\n        }\n        const active = renderUpdateUi(info);\n        updateTimer = setTimeout(pollAppUpdate, active ? 2000 : 60000);\n      } catch (err) {\n        updateConnectionError = err?.message || str('cardOpFailed');\n        if (currentUpdateInfo) renderUpdateUi(currentUpdateInfo);\n        updateTimer = setTimeout(pollAppUpdate, 5000);\n      }\n    }\n\n    async function onCheckUpdateClick() {\n      if (updateChecking) return;\n      if (updateTimer) {\n        clearTimeout(updateTimer);\n        updateTimer = null;\n      }\n      if (manualCheckTimer) {\n        clearTimeout(manualCheckTimer);\n        manualCheckTimer = null;\n      }\n      updateChecking = true;\n      manualCheckStatus = '';\n      manualCheckError = '';\n      renderUpdateUi();\n      try {\n        const reply = await sendProxyAction('app-update-info', { force: true });\n        const info = reply?.updateInfo ?? null;\n        updateChecking = false;\n        updateConnectionError = '';\n        if (info?.checkError && !info?.available) {\n          manualCheckStatus = 'failed';\n          manualCheckError = info.checkError;\n        } else if (!info?.available && !info?.unsupported) {\n          manualCheckStatus = 'latest';\n          manualCheckTimer = setTimeout(() => {\n            manualCheckTimer = null;\n            if (manualCheckStatus === 'latest') {\n              manualCheckStatus = '';\n              renderUpdateUi();\n            }\n          }, 5000);\n        }\n        const active = renderUpdateUi(info);\n        updateTimer = setTimeout(pollAppUpdate, active ? 2000 : 60000);\n      } catch (err) {\n        updateChecking = false;\n        manualCheckStatus = 'failed';\n        manualCheckError = err?.message || str('cardOpFailed');\n        renderUpdateUi();\n        updateTimer = setTimeout(pollAppUpdate, 60000);\n      }\n    }\n\n    async function onUpgradeClick() {\n      const upgradeEl = document.getElementById('btnAppUpdate');\n      if (upgradeEl?.disabled || upgradeStarting) return;\n      if (updateTimer) {\n        clearTimeout(updateTimer);\n        updateTimer = null;\n      }\n      upgradeStarting = true;\n      manualCheckStatus = '';\n      manualCheckError = '';\n      renderUpdateUi();\n      try {\n        const reply = await sendProxyAction('app-update-start', {});\n        upgradeStarting = false;\n        updateConnectionError = '';\n        renderUpdateUi(reply?.updateInfo ?? null);\n      } catch (err) {\n        upgradeStarting = false;\n        updateConnectionError = err?.message || str('cardOpFailed');\n        renderUpdateUi();\n      }\n      updateTimer = setTimeout(pollAppUpdate, 1000);\n    }\n\n    function initCard() {\n      applyStaticLanguage();\n      syncThemeWithHost();\n      checkSummaryOverflow();\n      setupScrollListener();\n      fetchSessionSnapshot(conversationId);\n      initEventStream();\n      void pollAppUpdate();\n\n      // 当在 Antigravity 切换对话时自动刷新对应会话状态\n      setInterval(() => {\n        const currentActive = (window.sidecar?.conversationId || new URLSearchParams(window.location.search).get(\"conversationId\") || \"\").trim();\n        if (currentActive && currentActive !== conversationId) {\n          switchConversation(currentActive);\n        }\n      }, 1000);\n    }\n\n    if (document.readyState === 'loading') {\n      document.addEventListener('DOMContentLoaded', initCard);\n    } else {\n      initCard();\n    }\n  </script>\n</body>\n</html>";
    (function () {
      var module = { exports: {} };
'use strict';

// Pure presentation rules. Browser and Mods adapters are built from this same factory.
function createPresentation(lang) {
  const normalizeLang = value => (value === 'en' ? 'en' : 'zh');
  const currentLang = normalizeLang(lang ?? (typeof globalThis !== 'undefined' ? globalThis.__agentThingsLang : undefined));
  const colors = { unstarted: '#9098a2', unfinished: '#c89b38', completed: '#548eea', pushed: '#a17be3' };
  const layout = { contentWidth: 300, panelWidth: 340, progressNodes: [0, 25, 50, 75, 100] };
  const accent = { normal: '#0169CC', hover: '#005bb3', pressed: '#004f9c', onAccent: '#FFFFFF' };
  const claudeCodeThemes = {
    'claude-light': '#C6613F',
    'claude-dark': '#D97757',
    'github-light': '#0969DA',
    'github-light-high-contrast': '#0550AE',
    'github-dark': '#1F6FEB',
    'github-dark-dimmed': '#316DCA',
    'github-dark-high-contrast': '#409EFF',
    'pierre-light': '#0073E6',
    'pierre-dark': '#0087EE',
    'vscode-light': '#007ACC',
    'vscode-dark': '#007ACC',
    'one-light': '#4078F2',
    'one-dark-pro': '#61AFEF',
    'catppuccin-latte': '#8839EF',
    'catppuccin-mocha': '#CBA6F7',
    'solarized-light': '#268BD2',
    'solarized-dark': '#268BD2',
    'vitesse-light': '#4D9375',
    'vitesse-dark': '#4D9375',
    'min-light': '#256ABF',
    'min-dark': '#5598E7',
    'rose-pine-dawn': '#D7827E',
    'rose-pine': '#EA9A97',
    'slack-ochin': '#1264A3',
    'slack-dark': '#36C5F0',
    'dracula': '#BD93F9',
    'dracula-soft': '#BD93F9',
    'nord': '#88C0D0',
    'monokai': '#F92672',
    'tokyo-night': '#7AA2F7',
    'night-owl': '#82AAFF',
    'ayu-dark': '#E6B450',
  };

  function normalizeHexColor(value, fallback = null) {
    if (typeof value !== 'string') return fallback;
    const raw = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
      return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toUpperCase();
    }
    const rgbMatch = raw.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i);
    if (rgbMatch) {
      const toHex = n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
      return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`.toUpperCase();
    }
    return fallback;
  }

  function hexToRgb(hex) {
    const clean = normalizeHexColor(hex, '#0169CC').slice(1);
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

  function getRelativeLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(channel => {
      const srgb = channel / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function mixHexColors(hexA, hexB, weightA) {
    const [r1, g1, b1] = hexToRgb(hexA);
    const [r2, g2, b2] = hexToRgb(hexB);
    const wA = Math.max(0, Math.min(1, weightA));
    const wB = 1 - wA;
    const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(r1 * wA + r2 * wB)}${toHex(g1 * wA + g2 * wB)}${toHex(b1 * wA + b2 * wB)}`.toUpperCase();
  }

  function resolveAccentPalette(rawColor, { isDark = true, fallback = '#0169CC' } = {}) {
    const normal = normalizeHexColor(rawColor, normalizeHexColor(fallback, '#0169CC'));
    const lum = getRelativeLuminance(normal);
    const onAccent = lum > 0.45 ? '#0D0D0D' : '#FFFFFF';
    // Darken bright accents or shade toward dark/light ink subtly without losing hue identity.
    const mixTarget = lum > 0.45 ? '#000000' : (isDark ? '#FFFFFF' : '#000000');
    const hoverWeight = lum > 0.45 ? 0.88 : (isDark ? 0.88 : 0.88);
    const pressedWeight = lum > 0.45 ? 0.78 : (isDark ? 0.78 : 0.78);
    return {
      normal,
      hover: mixHexColors(normal, mixTarget, hoverWeight),
      pressed: mixHexColors(normal, mixTarget, pressedWeight),
      onAccent,
    };
  }

  const locales = {
    zh: {
      appTitle: 'Agent Things',
      docTitleSuffix: '任务进展',
      defaultDocTitle: 'Agent Things 会话任务进度',
      defaultSessionTitle: '当前会话',
      fallbackShortTitle: '会话进度',
      fallbackThreadTitle: '会话',
      labels: {
        unstarted: '尚未开始',
        unfinished: '有遗留事项',
        completed: '全部完成',
        pushed: '全部完成并已推送',
      },
      taskLabels: {
        todo: '待开始',
        in_progress: '进行中',
        blocked: '受阻',
        needs_verification: '待验收',
        done: '已完成',
        unknown: '状态未知',
      },
      unrecordedSummary: '尚未记录进展',
      unorganized: '未整理',
      progressUnrecorded: '进度未记录',
      sidebarUpdating: '正在更新进度',
      sidebarTooltipPattern: '{title}：{status}，点击记录任务进展',
      noTasksYet: '暂无任务统计',
      totalsPattern: '已完成 {done} / {total} 项任务',
      basisPattern: '已完成 {done}/{total} 项任务，剩余 {remaining} 项（{remainingPercent}%）',
      basisEmpty: '暂无任务',
      sourceAuto: '自动分析',
      sourceManual: '手动调整',
      sourceManualRecord: '手动记录',
      btnUpdate: '更新进度',
      btnUpdating: '正在分析…',
      btnAdjust: '手动调整',
      btnClear: '清除进度',
      clearTooltip: '立即清除进度与任务记录',
      clearConfirm: '确定要清除本会话的任务进度和记录吗？',
      clearingFeedback: '正在清除…',
      clearedFeedback: '✓ 已清空进度',
      clearFailedPrefix: '清除失败: ',
      openInSidebar: '在侧栏打开',
      openPaneFailedPrefix: '打开侧栏失败: ',
      close: '关闭',
      expandAll: '查看全部',
      collapse: '收起',
      remainingHeadingPattern: '剩余任务 {count}',
      showAllCountPattern: '查看全部 {count} 条 ›',
      collapseArrow: '收起 ›',
      emptyNoTasks: '点击更新进度，整理这次会话的任务',
      emptyNoRemaining: '暂无未完成任务',
      completedHeading: '已完成任务',
      countArrowPattern: '{count} 条 ›',
      notesLabel: '备注',
      addLabel: '添加',
      editLabel: '编辑',
      untitledTask: '未命名事项',
      completedTaskFallback: '已完成事项',
      viewSource: '查看来源',
      viewSourceAriaPrefix: '查看来源：',
      backLabel: '‹ 返回',
      backPlain: '返回',
      emptyCompleted: '暂无已完成任务',
      emptySourceText: '此记录没有可显示的原文',
      editHeading: '手动记录会话状态',
      progressLabel: '进度',
      progressAltPattern: '进度 {value}%',
      progressUnrecordedWord: '未记录',
      currentProgressAlt: '当前进度',
      clearValueBtn: '清空进度',
      notePlaceholder: '记下下一步要做的事…',
      noteAriaLabel: '事项备注',
      sliderAriaLabel: '拖动调整进度',
      cancelBtn: '取消',
      saveBtn: '保存记录',
      savingBtn: '正在保存…',
      savingFeedback: '正在保存…',
      savedFeedback: '✓ 保存成功',
      saveFailedPrefix: '保存失败: ',
      conflictBanner: '保存冲突：内容已被其他入口修改。当前草稿已保留。',
      conflictShortToast: '保存冲突，已保留当前草稿',
      conflictDetectedFeedback: '保存失败：检测到版本冲突',
      resolveConflictBtn: '读取最新版本并保留草稿',
      conflictRebasedFeedback: '基准版本已对齐最新状态，再次点击保存即可提交当前草稿。',
      conflictReloadedFeedback: '已读取最新版本，草稿已保留。再次保存即可提交。',
      timelineHeading: '进展记录',
      timelineLink: '进展记录 ›',
      emptyTimeline: '暂无进展记录',
      dividerAlt: '分隔线',
      loadingTitle: '正在读取会话进度…',
      loadingAlt: '加载中',
      loadingTasksAlt: '正在加载任务列表',
      loadingSubtitle: '正在同步当前会话任务，完成后将自动更新…',
      notLoadedTitle: '尚未读取到会话进度',
      notLoadedAlt: '未读取',
      retryLoadBtn: '重试读取',
      processing: '正在处理…',
      retryingStatus: '状态查询暂时失败，正在重试…',
      locatingMessage: '正在定位消息…',
      locatingShort: '定位中...',
      locatingSourceMessage: '正在定位来源消息…',
      locatedMessage: '已定位来源',
      locatedJumpMessage: '已跳转并定位到会话来源',
      locateSent: '已发送定位请求',
      locateFailedPrefix: '定位失败：',
      locateHostUnavailable: '未能连接宿主定位接口',
      locateNotFound: '未找到对应会话消息',
      locateUnsupported: '当前环境不支持跳转来源',
      locateTimeout: '定位来源超时，请在原会话中确认历史消息',
      locateNoSource: '此记录没有可定位的消息',
      locateHostDisconnected: '当前宿主未连接，暂时无法定位来源消息',
      locateOpenFailed: '无法打开来源会话',
      locateUnavailable: '暂时无法定位来源消息',
      locateCommandErrorPrefix: '跳转失败：',
      startingAnalysisFeedback: '正在开始分析…',
      updateFailedPrefix: '更新失败: ',
      analysisNotDonePrefix: '分析未完成: ',
      analysisFailedPrefix: '分析失败：',
      analysisFailedWord: '分析失败',
      analyzingWord: '分析中',
      analysisFailedRetry: '请重试',
      analysisAbnormal: '执行异常',
      analysisStages: {
        starting: '正在启动分析…',
        reading: '正在读取会话…',
        analyzing: '正在分析任务…',
        retrying: '正在重新连接…',
      },
      invalidProgressError: '请输入 0–100 的整数，或留空',
      unknownActionError: '未知错误',
      gitCheckUnavailable: '暂时无法检测 Git 信息',
      sidebarHintText: '如需启用侧边栏插件，请打开「开发者 → Enable Main Process Debugger」。',
      dismissHint: '不再提醒',
      updateStages: {
        queued: '正在准备升级',
        checking: '正在检查版本',
        downloading: '正在下载新版本',
        waiting: '等待当前分析结束',
        installing: '正在升级',
      },
      updateAvailablePattern: '发现新版本 v{version}',
      upgradedToPattern: '已升级至 v{version}',
      updateFailedLabel: '升级失败',
      upgradeBtn: '立即升级',
      upgradingShort: '正在升级…',
      checkUpdateBtn: '检查更新',
      checkingUpdateShort: '正在检查…',
      alreadyLatestPattern: '当前已是最新版 v{version}',
      versionTagPattern: 'v{version}',
      checkUpdateFailedLabel: '检查更新失败',
      pleaseWait: '请稍候',
      completedShort: '已完成',
      retryBtn: '重试',
      terminalUpgradePrefix: '终端升级：',
      reconnectHint: '正在重新连接后台，升级状态将在连接后恢复',
      reconnectMcpHint: '请在客户端重新连接 MCP 服务',
      cardCommandDescription: '打开会话任务进度卡片',
      cardCommandReply: 'Agent Things · 会话任务进度',
      cardMissingSession: '卡片缺少当前会话信息',
      cardAuthUnavailable: '卡片授权不可用，请重新打开会话进度卡片',
      cardSyncUnavailable: '卡片同步暂不可用',
      cardTimeout: '卡片连接超时',
      cardClosed: '卡片已关闭',
      cardOpFailed: '卡片操作失败',
      cardRequestCancelled: '请求已取消',
      cardRequestTimeout: '请求超时，请重试',
      cardStatusDisconnected: '状态连接暂不可用',
      cardDaemonDisconnected: '本地进程已断开',
      claudeInlineOffline: '本地后台连接失败',
      mdProgressHeading: '当前会话任务进度',
      mdStateDone: '全部完成 (100%)',
      mdStateUnstarted: '未开始',
      mdTasksOverview: '任务总览',
      mdTasksEmpty: '暂无任务清单',
      mdNotesLabel: '会话备注',
      mdQuickActionsLabel: '快捷交互',
      mdQuickActionsText: '可在卡片中点击“手动调整”滑动调整进度或修改备注，或点击“更新进度”开始自动分析。',
      hookPresentedMessage: '已呈现当前会话任务进度卡片',
      noSessionBadge: '无会话',
      offlineBadge: '离线',
      badgeNotOrganized: '未整理',
      badgeProgressUnrecordedSuffix: ' · 进度未记录',
      ringAriaPattern: '{title}：{summary}，点击记录任务进展',
      ringUpdating: '正在更新进度',
      sessionFallbackTitle: '会话',
      statusUnrecorded: '尚未记录进展',
      panelAriaPattern: '{title} 任务进展',
      totalsEmpty: '暂无任务统计',
      taskUnknown: '状态未知',
      timelineAnalysis: '自动分析',
      timelineManual: '手动记录',
      unrecordedShort: '未记录',
    },
    en: {
      appTitle: 'Agent Things',
      docTitleSuffix: 'Progress',
      defaultDocTitle: 'Agent Things Progress',
      defaultSessionTitle: 'Current session',
      fallbackShortTitle: 'Session progress',
      fallbackThreadTitle: 'Session',
      labels: {
        unstarted: 'Not started',
        unfinished: 'Remaining items',
        completed: 'Completed',
        pushed: 'Completed & pushed',
      },
      taskLabels: {
        todo: 'To do',
        in_progress: 'In progress',
        blocked: 'Blocked',
        needs_verification: 'Needs verification',
        done: 'Done',
        unknown: 'Unknown status',
      },
      unrecordedSummary: 'No progress recorded',
      unorganized: 'Not organized',
      progressUnrecorded: 'Progress not recorded',
      sidebarUpdating: 'Updating progress',
      sidebarTooltipPattern: '{title}: {status} · Click to track progress',
      noTasksYet: 'No task stats yet',
      totalsPattern: '{done} of {total} tasks done',
      basisPattern: 'Completed {done}/{total} tasks, {remaining} remaining ({remainingPercent}%)',
      basisEmpty: 'No tasks yet',
      sourceAuto: 'Auto-analyzed',
      sourceManual: 'Manual',
      sourceManualRecord: 'Manual',
      btnUpdate: 'Update progress',
      btnUpdating: 'Analyzing...',
      btnAdjust: 'Adjust',
      btnClear: 'Clear',
      clearTooltip: 'Clear progress and task records now',
      clearConfirm: 'Clear progress and task records for this session?',
      clearingFeedback: 'Clearing...',
      clearedFeedback: '✓ Cleared',
      clearFailedPrefix: 'Clear failed: ',
      openInSidebar: 'Open in sidebar',
      openPaneFailedPrefix: 'Open sidebar failed: ',
      close: 'Close',
      expandAll: 'Show all',
      collapse: 'Collapse',
      remainingHeadingPattern: 'Remaining tasks ({count})',
      showAllCountPattern: 'Show all {count} ›',
      collapseArrow: 'Collapse ›',
      emptyNoTasks: 'Click Update progress to organize tasks for this session',
      emptyNoRemaining: 'No remaining tasks',
      completedHeading: 'Completed tasks',
      countArrowPattern: '{count} ›',
      notesLabel: 'Notes',
      addLabel: 'Add',
      editLabel: 'Edit',
      untitledTask: 'Untitled task',
      completedTaskFallback: 'Completed task',
      viewSource: 'View source',
      viewSourceAriaPrefix: 'View source: ',
      backLabel: '‹ Back',
      backPlain: 'Back',
      emptyCompleted: 'No completed tasks',
      emptySourceText: 'No original message text available for this record',
      editHeading: 'Set session status',
      progressLabel: 'Progress',
      progressAltPattern: 'Progress {value}%',
      progressUnrecordedWord: 'unrecorded',
      currentProgressAlt: 'Current progress',
      clearValueBtn: 'Clear value',
      notePlaceholder: 'Add next steps or notes...',
      noteAriaLabel: 'Session notes',
      sliderAriaLabel: 'Drag to adjust progress',
      cancelBtn: 'Cancel',
      saveBtn: 'Save',
      savingBtn: 'Saving...',
      savingFeedback: 'Saving...',
      savedFeedback: '✓ Saved',
      saveFailedPrefix: 'Save failed: ',
      conflictBanner: 'Save conflict: updated elsewhere. Your draft has been kept.',
      conflictShortToast: 'Save conflict, draft kept',
      conflictDetectedFeedback: 'Save failed: revision conflict detected',
      resolveConflictBtn: 'Load latest & keep draft',
      conflictRebasedFeedback: 'Synced to latest version. Click Save again to submit your draft.',
      conflictReloadedFeedback: 'Loaded latest version with draft preserved. Save again to submit.',
      timelineHeading: 'Timeline',
      timelineLink: 'Timeline ›',
      emptyTimeline: 'No activity yet',
      dividerAlt: 'Divider',
      loadingTitle: 'Loading session progress...',
      loadingAlt: 'Loading',
      loadingTasksAlt: 'Loading task list',
      loadingSubtitle: 'Syncing session tasks, will update automatically...',
      notLoadedTitle: 'Session progress not loaded yet',
      notLoadedAlt: 'Not loaded',
      retryLoadBtn: 'Retry',
      processing: 'Processing...',
      retryingStatus: 'Status check failed, retrying...',
      locatingMessage: 'Locating message...',
      locatingShort: 'Locating...',
      locatingSourceMessage: 'Locating source message...',
      locatedMessage: 'Source located',
      locatedJumpMessage: 'Jumped to source message',
      locateSent: 'Locate request sent',
      locateFailedPrefix: 'Locate failed: ',
      locateHostUnavailable: 'Unable to reach host locate API',
      locateNotFound: 'Source message not found',
      locateUnsupported: 'Jumping to source is not supported here',
      locateTimeout: 'Locate timed out. Please check conversation history.',
      locateNoSource: 'No locatable source message for this item',
      locateHostDisconnected: 'Host is disconnected, unable to locate source message',
      locateOpenFailed: 'Unable to open source session',
      locateUnavailable: 'Unable to locate source message right now',
      locateCommandErrorPrefix: 'Jump failed: ',
      startingAnalysisFeedback: 'Starting analysis...',
      updateFailedPrefix: 'Update failed: ',
      analysisNotDonePrefix: 'Analysis incomplete: ',
      analysisFailedPrefix: 'Analysis failed: ',
      analysisFailedWord: 'Analysis failed',
      analyzingWord: 'Analyzing',
      analysisFailedRetry: 'please retry',
      analysisAbnormal: 'execution error',
      analysisStages: {
        starting: 'Starting analysis...',
        reading: 'Reading session...',
        analyzing: 'Analyzing tasks...',
        retrying: 'Reconnecting...',
      },
      invalidProgressError: 'Enter an integer 0–100, or leave blank',
      unknownActionError: 'Unknown error',
      gitCheckUnavailable: 'Git status unavailable right now',
      sidebarHintText: 'To enable the sidebar pane, open Developer → Enable Main Process Debugger.',
      dismissHint: 'Dismiss',
      updateStages: {
        queued: 'Preparing upgrade',
        checking: 'Checking version',
        downloading: 'Downloading update',
        waiting: 'Waiting for analysis to finish',
        installing: 'Upgrading',
      },
      updateAvailablePattern: 'Update available v{version}',
      upgradedToPattern: 'Upgraded to v{version}',
      updateFailedLabel: 'Upgrade failed',
      upgradeBtn: 'Upgrade',
      upgradingShort: 'Upgrading...',
      checkUpdateBtn: 'Check updates',
      checkingUpdateShort: 'Checking...',
      alreadyLatestPattern: 'Up to date (v{version})',
      versionTagPattern: 'v{version}',
      checkUpdateFailedLabel: 'Update check failed',
      pleaseWait: 'Please wait',
      completedShort: 'Done',
      retryBtn: 'Retry',
      terminalUpgradePrefix: 'Terminal upgrade: ',
      reconnectHint: 'Reconnecting to background service; upgrade status will resume shortly',
      reconnectMcpHint: 'Please reconnect the MCP server in your client',
      cardCommandDescription: 'Open session task progress card',
      cardCommandReply: 'Agent Things · Session Progress',
      cardMissingSession: 'Card is missing current session info',
      cardAuthUnavailable: 'Card authorization unavailable; please reopen the card',
      cardSyncUnavailable: 'Card sync unavailable',
      cardTimeout: 'Card connection timed out',
      cardClosed: 'Card closed',
      cardOpFailed: 'Card action failed',
      cardRequestCancelled: 'Request cancelled',
      cardRequestTimeout: 'Request timed out, please retry',
      cardStatusDisconnected: 'Status connection unavailable',
      cardDaemonDisconnected: 'Local service disconnected',
      claudeInlineOffline: 'Local service connection failed',
      mdProgressHeading: 'Session task progress',
      mdStateDone: 'Completed (100%)',
      mdStateUnstarted: 'Not started',
      mdTasksOverview: 'Overview',
      mdTasksEmpty: 'No task checklist yet',
      mdNotesLabel: 'Session notes',
      mdQuickActionsLabel: 'Quick actions',
      mdQuickActionsText: 'Click "Adjust" on the card to set progress/notes manually, or click "Update progress" to auto-analyze.',
      hookPresentedMessage: 'Session task progress card presented',
      noSessionBadge: 'No session',
      offlineBadge: 'Offline',
      badgeNotOrganized: 'Not organized',
      badgeProgressUnrecordedSuffix: ' · Progress unrecorded',
      ringAriaPattern: '{title}: {summary}. Click to track progress',
      ringUpdating: 'Updating progress',
      sessionFallbackTitle: 'Session',
      statusUnrecorded: 'No progress recorded',
      panelAriaPattern: '{title} Task Progress',
      totalsEmpty: 'No task metrics yet',
      taskUnknown: 'Unknown status',
      timelineAnalysis: 'Auto analysis',
      timelineManual: 'Manual record',
      unrecordedShort: 'Unrecorded',
    },
  };

  function format(template, vars = {}) {
    return String(template || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
  }

  function forLang(targetLang) {
    const code = normalizeLang(targetLang);
    const dict = locales[code];
    return {
      lang: code,
      strings: dict,
      labels: dict.labels,
      taskLabels: dict.taskLabels,
      t(key, vars) {
        return format(dict[key] ?? locales.zh[key] ?? key, vars);
      },
      formatDate(value) {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      },
    };
  }

  function progressValue(value, dragging = false) {
    value = Math.max(0, Math.min(100, Math.round(value)));
    const nearest = Math.round(value / 25) * 25;
    return dragging && Math.abs(value - nearest) <= 2 ? nearest : value;
  }
  function progressState(state, value) {
    return value === 100 ? state === 'pushed' ? 'pushed' : 'completed'
      : value === 0 && state === 'unstarted' ? 'unstarted' : 'unfinished';
  }
  function draftTransition(current, event) {
    if (event.type === 'begin') return { draft: { state: event.record?.state || 'unfinished', progress: event.record?.progress ?? null, note: event.record?.note || '' }, baseRevision: event.revision ?? event.record?.revision ?? 0, conflict: false };
    if (event.type === 'patch') return { ...current, draft: { ...current.draft, ...event.patch } };
    if (event.type === 'conflict') return { ...current, conflict: true };
    if (event.type === 'rebase') return { ...current, baseRevision: event.revision, conflict: false };
    if (event.type === 'saved' || event.type === 'cleared') return { draft: null, baseRevision: event.revision, conflict: false };
    return current;
  }
  function analysisDisabled(busy, analyzing, upgradeStage) {
    return Boolean(busy || analyzing || ['waiting', 'installing'].includes(upgradeStage));
  }
  function updateBannerState(info, dict, options = {}) {
    const textDict = dict || {};
    const fmtText = (template, vars = {}) => String(template || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
    const update = info?.update;
    const stage = update?.stage;
    const stages = textDict.updateStages || {
      queued: 'Preparing upgrade',
      checking: 'Checking version',
      downloading: 'Downloading update',
      waiting: 'Waiting for analysis to finish',
      installing: 'Upgrading',
    };
    const activeStage = Boolean(stages[stage]) || Boolean(options.starting);
    const updatedAtMs = update?.updatedAt ? Date.parse(update.updatedAt) : NaN;
    const now = options.now ?? Date.now();
    const completed = stage === 'completed' && Number.isFinite(updatedAtMs) && now - updatedAtMs < 60000;
    const failed = stage === 'failed';
    const visible = Boolean(info?.available || activeStage || failed || completed);
    const command = info?.command || 'npx agent-things@latest';
    const label = activeStage
      ? (stages[stage] || stages.queued)
      : failed
        ? fmtText(textDict.updateFailedLabel || 'Upgrade failed')
        : completed
          ? fmtText(textDict.upgradedToPattern || 'Upgraded to v{version}', { version: update?.currentVersion || '' })
          : fmtText(textDict.updateAvailablePattern || 'Update available v{version}', { version: info?.latestVersion || '' });
    const buttonText = activeStage
      ? (textDict.pleaseWait || 'Please wait')
      : completed
        ? (textDict.completedShort || 'Done')
        : failed
          ? (textDict.retryBtn || 'Retry')
          : (textDict.upgradeBtn || 'Upgrade');
    const detail = options.connectionError
      ? `${textDict.reconnectHint || ''}\n${textDict.terminalUpgradePrefix || ''}${command}`
      : failed
        ? `${update?.error || ''}\n${textDict.terminalUpgradePrefix || ''}${command}`
        : (completed && update?.reconnectMcp ? (textDict.reconnectMcpHint || '') : '');
    const currentVersion = info?.currentVersion || '';
    const unsupported = Boolean(info?.unsupported);
    const checkFailed = !visible && !unsupported && options.manualCheckStatus === 'failed';
    let versionText = currentVersion ? fmtText(textDict.versionTagPattern || 'v{version}', { version: currentVersion }) : '';
    if (checkFailed) {
      const errText = options.checkError || info?.checkError || '';
      versionText = errText ? `${textDict.checkUpdateFailedLabel || 'Update check failed'}: ${errText}` : (textDict.checkUpdateFailedLabel || 'Update check failed');
    } else if (!visible && !unsupported && options.manualCheckStatus === 'latest' && currentVersion) {
      versionText = fmtText(textDict.alreadyLatestPattern || 'Up to date (v{version})', { version: currentVersion });
    }
    const checking = Boolean(options.checking);
    return {
      visible,
      active: activeStage,
      completed,
      failed,
      buttonDisabled: activeStage || completed,
      label,
      buttonText,
      detail,
      currentVersion,
      versionText,
      showVersionBar: !visible,
      showCheckButton: !unsupported,
      checking,
      checkDisabled: checking || unsupported,
      checkFailed,
      checkButtonText: checking ? (textDict.checkingUpdateShort || 'Checking...') : (textDict.checkUpdateBtn || 'Check updates'),
    };
  }

  const active = forLang(currentLang);
  return {
    lang: active.lang,
    labels: active.labels,
    colors,
    taskLabels: active.taskLabels,
    strings: active.strings,
    locales,
    layout,
    accent,
    claudeCodeThemes,
    normalizeHexColor,
    resolveAccentPalette,
    t: active.t,
    format,
    forLang,
    formatDate: active.formatDate,
    progressValue,
    progressState,
    draftTransition,
    analysisDisabled,
    updateBannerState,
  };
}

const browserSource = `globalThis.__agentThingsPresentation = (${createPresentation.toString()})(globalThis.__agentThingsLang);`;
module.exports = { createPresentation, browserSource };
      if (typeof globalThis !== 'undefined' && module.exports && typeof module.exports.createPresentation === 'function') {
        globalThis.__agentThingsCreatePresentation = module.exports.createPresentation;
        if (!globalThis.__agentThingsPresentation) {
          globalThis.__agentThingsPresentation = module.exports.createPresentation(globalThis.__agentThingsLang);
        }
      }
    })();
/* Manual session marks. Loaded in a dedicated CDP isolated world. */
function installCodexSessionStatus(version, restored, embedded) {
  if (window.__codexSessionStatus && !embedded?.independent) return;
  const harness = embedded?.independent ? null : window.__sessionStatusHarness || null;
  let localCards = null;
  const send = payload => {
    if (embedded) embedded.send(payload);
    else if (harness?.send) harness.send(payload);
    else window.__codexSessionStatusSend(payload);
  };
  const presentation = window.__agentThingsPresentation;
  let activeLang = embedded?.lang || embedded?.snapshot?.lang || window.__agentThingsConnection?.lang || window.__agentThingsLang || presentation?.lang || 'zh';
  let ui = presentation?.forLang ? presentation.forLang(activeLang) : null;
  let strings = ui?.strings || presentation?.strings || {};
  let labels = ui?.labels || presentation?.labels || {
    unstarted: '尚未开始', unfinished: '有遗留事项', completed: '全部完成', pushed: '全部完成并已推送',
  };
  let taskLabels = ui?.taskLabels || presentation?.taskLabels || {
    todo: '待开始', in_progress: '进行中', blocked: '受阻', needs_verification: '待验收', done: '已完成',
  };
  const S = (key, vars) => (ui?.t ? ui.t(key, vars) : (strings[key] || key));
  const setLang = nextLang => {
    const resolved = nextLang === 'en' ? 'en' : nextLang === 'zh' ? 'zh' : activeLang;
    if (!presentation?.forLang || (resolved === activeLang && ui)) return false;
    activeLang = resolved;
    ui = presentation.forLang(activeLang);
    strings = ui.strings;
    labels = ui.labels;
    taskLabels = ui.taskLabels;
    return true;
  };
  const colors = presentation?.colors || { unstarted: '#9098a2', unfinished: '#c89b38', completed: '#548eea', pushed: '#a17be3' };
  let currentAccent = presentation?.accent?.normal || '#0169CC';
  let currentAccentPalette = presentation?.accent || { normal: '#0169CC', hover: '#005bb3', pressed: '#004f9c', onAccent: '#FFFFFF' };
  function resolveHostAccent(isDark = true) {
    const raw = (window.__agentThingsHostAccent || document.documentElement.style.getPropertyValue('--agent-things-accent') || (() => {
      try {
        const rootStyle = getComputedStyle(document.documentElement);
        for (const varName of ['--codex-base-accent', '--color-button-accent', '--primary', '--agent-things-accent']) {
          const candidate = rootStyle.getPropertyValue(varName).trim();
          if (candidate) return candidate;
        }
      } catch {}
      return '';
    })()).trim();
    const fallback = presentation?.accent?.normal || '#0169CC';
    return presentation?.resolveAccentPalette
      ? presentation.resolveAccentPalette(raw || fallback, { isDark, fallback })
      : { normal: raw || fallback, hover: '#005bb3', pressed: '#004f9c', onAccent: '#FFFFFF' };
  }
  function syncAccent(node, isDark = true) {
    const palette = resolveHostAccent(isDark);
    currentAccentPalette = palette;
    currentAccent = palette.normal;
    if (!node?.style) return palette;
    const pairs = [
      ['--accent', palette.normal],
      ['--accent-hover', palette.hover],
      ['--accent-pressed', palette.pressed],
      ['--on-accent', palette.onAccent],
    ];
    for (const [k, v] of pairs) {
      if (node.style.getPropertyValue(k) !== v) node.style.setProperty(k, v);
    }
    return palette;
  }
  let snapshot = { revision: 0, records: {} };
  const mounted = new Map();
  const pending = new Map();
  const panelStates = new Map(restored?.panelStates || []);
  let panel = null;
  let serial = 0;
  const requestPrefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let frame = 0;
  let destroyed = false;
  const startup = { installedAt: Date.now(), sidebarReadyAt: null, badgesReadyAt: null };
  function measureStartup() {
    if (startup.badgesReadyAt !== null) return;
    const rows = harness?.startupRows ? harness.startupRows().filter(visible)
      : [...document.querySelectorAll('[data-app-action-sidebar-project-list-id] [data-app-action-sidebar-thread-row]')].filter(row => ['local', 'remote'].includes(row.getAttribute('data-app-action-sidebar-thread-kind')) && visible(row));
    if (!rows.length) return;
    startup.sidebarReadyAt ??= Date.now();
    if (rows.every(row => row.querySelector('[data-codex-session-status]'))) startup.badgesReadyAt = Date.now();
  }

  function rememberPanel(target) {
    const active = target.root.shadowRoot.activeElement;
    const state = { key: target.entry.key, mode: target.mode, dirty: target.dirty, revision: target.revision,
      note: target.note.value, progress: target.progress.value, draft: { ...target.draft },
      remainingExpanded: target.remainingExpanded, scrollTop: target.body.scrollTop,
      noteScrollTop: target.note.scrollTop, selectionStart: target.note.selectionStart, selectionEnd: target.note.selectionEnd,
      focus: active === target.note ? 'note' : active === target.progress ? 'progress' : null,
      error: target.error.textContent, conflict: target.conflict };
    panelStates.set(target.entry.key, state);
    try { sessionStorage.setItem(`codex-session-status-panel:v1:${target.entry.key}`, JSON.stringify(state)); } catch { /* Keep the in-memory copy when storage is unavailable. */ }
    return state;
  }

  function rememberedPanel(key) {
    if (panelStates.has(key)) return panelStates.get(key);
    try {
      const state = JSON.parse(sessionStorage.getItem(`codex-session-status-panel:v1:${key}`));
      if (state && ['overview', 'edit', 'history'].includes(state.mode)) { panelStates.set(key, state); return state; }
    } catch { /* Start from the current saved record if a browser cache cannot be read. */ }
    return null;
  }

  function restorePanel(target, state) {
    target.remainingExpanded = state.remainingExpanded;
    if (state.dirty) {
      target.dirty = true; target.revision = state.revision;
      target.draft = state.draft || { state: recordFor(state.key)?.state || 'unfinished',
        progress: state.progress === '' ? null : Number(state.progress), note: state.note || '' };
      target.note.value = state.note; updateDraft(target, target.draft); target.progress.value = state.progress;
    }
    target.restoreScroll = state.scrollTop || 0;
    target.setView(state.mode || (state.dirty ? 'edit' : 'overview'));
    target.error.textContent = state.error || '';
    target.conflict = Boolean(state.dirty && state.conflict);
    target.resolveConflict.hidden = !target.conflict;
    if (target.mode === 'edit') {
      if (state.focus === 'note') {
        target.note.focus({ preventScroll: true });
        target.note.setSelectionRange(state.selectionStart ?? target.note.value.length, state.selectionEnd ?? target.note.value.length);
      } else if (state.focus === 'progress') target.progress.focus({ preventScroll: true });
      target.note.scrollTop = state.noteScrollTop || 0;
    }
  }

  function panelEvent(action, entry) {
    try { send(JSON.stringify({ type: 'panel-event', action,
      requestId: `${requestPrefix}:${++serial}`, key: entry.key })); } catch { /* Diagnostic only. */ }
  }

  function element(tag, text, parent, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    parent?.append(node);
    return node;
  }

  function recordFor(key) {
    const record = snapshot.records[key];
    return record?.state ? record : null;
  }

  function summary(key) {
    const record = recordFor(key);
    if (!record) return S('badgeNotOrganized');
    return `${labels[record.state]}${record.progress === null ? S('badgeProgressUnrecordedSuffix') : ` · ${record.progress}%`}`;
  }

  function makeRing(button, record, pie = false, loading = false) {
    button.replaceChildren();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
    svg.setAttribute('aria-hidden', 'true');
    if (loading) {
      svg.setAttribute('class', 'loading');
      const circle = document.createElementNS(svg.namespaceURI, 'circle');
      for (const [name, value] of Object.entries({ cx: 12, cy: 12, r: 10, fill: 'none', stroke: currentAccent || '#0169cc', 'stroke-width': 1.6, 'stroke-dasharray': '42 63', 'stroke-linecap': 'round' })) circle.setAttribute(name, value);
      svg.append(circle); button.append(svg); return;
    }
    const color = record ? colors[record.state] : '#858991';
    for (const progress of pie ? [null] : [null, record?.progress]) {
      if (progress === undefined || progress === null && svg.childElementCount) continue;
      const circle = document.createElementNS(svg.namespaceURI, 'circle');
      for (const [name, value] of Object.entries({ cx: 12, cy: 12, r: 10, fill: 'none', stroke: color, 'stroke-width': 1.6 })) {
        circle.setAttribute(name, value);
      }
      if (progress === null) circle.setAttribute('opacity', pie ? '1' : record?.progress != null ? '.25' : '.85');
      else {
        circle.setAttribute('stroke-dasharray', `${62.832 * progress / 100} 62.832`);
        circle.setAttribute('transform', 'rotate(-90 12 12)');
        circle.setAttribute('stroke-linecap', 'round');
      }
      svg.append(circle);
    }
    if (pie && record?.progress > 0) {
      const sector = document.createElementNS(svg.namespaceURI, 'path');
      const angle = record.progress / 100 * Math.PI * 2;
      const x = 12 + 7.4 * Math.sin(angle);
      const y = 12 - 7.4 * Math.cos(angle);
      sector.setAttribute('d', record.progress === 100
        ? 'M12 4.6a7.4 7.4 0 1 1 0 14.8a7.4 7.4 0 1 1 0-14.8'
        : `M12 12L12 4.6A7.4 7.4 0 ${record.progress > 50 ? 1 : 0} 1 ${x} ${y}Z`);
      sector.setAttribute('fill', color); sector.setAttribute('class', 'progress-pie');
      svg.append(sector);
    }
    if (pie || record) {
      const text = document.createElementNS(svg.namespaceURI, 'text');
      text.setAttribute('x', '12'); text.setAttribute('y', '12.4');
      text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', color);
      text.setAttribute('style', `font:600 ${pie ? 6.4 : 8}px -apple-system,BlinkMacSystemFont,sans-serif;font-variant-numeric:tabular-nums`);
      text.textContent = record?.progress == null ? '—' : pie ? `${record.progress}%` : String(record.progress);
      if (record?.progress == null) text.setAttribute('class', 'progress-unknown');
      svg.append(text);
    }
    button.append(svg);
  }

  function paintVisibility(entry) {
    const selected = harness?.isRowSelected ? harness.isRowSelected(entry.row) : entry.row.getAttribute('data-app-action-sidebar-thread-selected') === 'true';
    entry.host.toggleAttribute('data-visible', Boolean(recordFor(entry.key) || snapshot.analyzingKeys?.includes(entry.key) || entry.hovered || selected));
  }

  function paint(entry) {
    const record = recordFor(entry.key);
    const loading = snapshot.analyzingKeys?.includes(entry.key) || false;
    const ringKey = JSON.stringify([record?.state, record?.progress, loading]);
    if (entry.ringKey !== ringKey) { makeRing(entry.button, record, false, loading); entry.ringKey = ringKey; }
    paintVisibility(entry);
    entry.button.setAttribute('aria-busy', String(loading));
    const description = S('ringAriaPattern', { title: entry.title, summary: loading ? S('ringUpdating') : summary(entry.key) });
    entry.button.setAttribute('aria-label', description);
    entry.button.title = description;
  }

  function unmount(entry) {
    harness?.unmount?.(entry);
    entry.row.removeEventListener('pointerenter', entry.onEnter); entry.row.removeEventListener('pointerleave', entry.onLeave);
    entry.host.remove();
    for (const [name, previous] of Object.entries(entry.original)) {
      if (previous.value) entry.slot.style.setProperty(name, previous.value, previous.priority);
      else entry.slot.style.removeProperty(name);
    }
    if (entry.slot.classList.contains('status-slot-injected')) entry.slot.remove();
    mounted.delete(entry.row);
  }

  function attachHost(slot, emptyWrapper, placeholder) {
    const original = Object.fromEntries(['width', 'min-width', 'flex-basis'].map(name => [name, {
      value: slot.style.getPropertyValue(name), priority: slot.style.getPropertyPriority(name)
    }]));
    for (const name of Object.keys(original)) slot.style.setProperty(name, '24px');
    const target = emptyWrapper ? placeholder : slot;
    for (const existing of target.querySelectorAll('span[data-codex-session-status]')) {
      existing.remove();
    }
    const host = element('span', null, target);
    host.setAttribute('data-codex-session-status', '');
    host.style.cssText = 'display:flex;width:24px;height:28px;flex:none;align-items:center;justify-content:center';
    const shadow = host.attachShadow({ mode: 'open' });
    element('style', `:host{opacity:0}:host([data-visible]),:host(:focus-within){opacity:1}@keyframes status-spin{to{transform:rotate(360deg)}}svg.loading{animation:status-spin .85s linear infinite;transform-origin:center}button{all:unset;box-sizing:border-box;width:28px;height:28px;display:grid;place-items:center;cursor:pointer;border-radius:7px;transition:transform 160ms cubic-bezier(.23,1,.32,1),background-color 150ms cubic-bezier(.23,1,.32,1)}button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}button:active{transform:scale(.94)}button:focus-visible{outline:2px solid var(--accent,#0169cc);outline-offset:1px}svg{display:block;pointer-events:none}`, shadow);
    const button = element('button', null, shadow);
    button.type = 'button'; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    return { host, button, original };
  }

  function reconcile() {
    frame = 0;
    if (destroyed) return;
    measureStartup();
    if (harness?.reconcile) {
      harness.reconcile({ mounted, unmount, attachHost, paint, paintVisibility, openPanel, closePanel, isPanelBusy: () => panel?.busy, isPanelEntry: e => panel?.entry === e });
      measureStartup();
      if (panel && (!panel.entry.host.isConnected || !visible(panel.entry.host))) closePanel(false);
      else positionPanel();
      return;
    }
    for (const entry of mounted.values()) {
      if (!entry.row.isConnected || !entry.host.isConnected || !entry.row.closest('[data-app-action-sidebar-project-list-id]') ||
          !['local', 'remote'].includes(entry.row.getAttribute('data-app-action-sidebar-thread-kind')) ||
          entry.row.getAttribute('data-app-action-sidebar-thread-id') !== entry.threadId ||
          entry.row.getAttribute('data-app-action-sidebar-thread-host-id') !== entry.rawHost) unmount(entry);
    }
    const rows = document.querySelectorAll('[data-app-action-sidebar-project-list-id] [data-app-action-sidebar-thread-row]');
    for (const row of rows) {
      const kind = row.getAttribute('data-app-action-sidebar-thread-kind');
      if (kind !== 'local' && kind !== 'remote') continue;
      const threadId = row.getAttribute('data-app-action-sidebar-thread-id');
      if (!threadId) continue;
      const titleNode = row.querySelector('[data-thread-title]');
      const title = row.getAttribute('data-app-action-sidebar-thread-title') || titleNode?.textContent || S('sessionFallbackTitle');
      const existing = mounted.get(row);
      if (existing) {
        if (existing.title !== title) { existing.title = title; paint(existing); }
        paintVisibility(existing);
        continue;
      }
      // Target the existing reserved leading slot; leave occupied native icons intact.
      const trigger = titleNode?.closest('[data-thread-title-trigger]');
      const slot = trigger?.previousElementSibling;
      if (!slot || !slot.classList.contains('w-4')) continue;
      // Native rows keep an empty relative wrapper inside the leading slot.
      const placeholder = slot.firstElementChild;
      const emptyWrapper = slot.childElementCount === 1 && placeholder.tagName === 'DIV' &&
        placeholder.childElementCount === 0 && !placeholder.textContent.trim();
      if (slot.childElementCount !== 0 && !emptyWrapper) continue;
      const rawHost = row.getAttribute('data-app-action-sidebar-thread-host-id');
      const key = JSON.stringify([rawHost || (kind === 'remote' ? 'cloud' : 'local'), threadId]);
      const { host, button, original } = attachHost(slot, emptyWrapper, placeholder);
      const entry = { row, key, threadId, rawHost, title, slot, host, button, original, hovered: row.matches(':hover') };
      entry.onEnter = () => { entry.hovered = true; paintVisibility(entry); };
      entry.onLeave = () => { entry.hovered = false; paintVisibility(entry); };
      row.addEventListener('pointerenter', entry.onEnter); row.addEventListener('pointerleave', entry.onLeave);
      for (const type of ['pointerdown', 'dblclick']) host.addEventListener(type, e => e.stopPropagation());
      button.addEventListener('click', async e => {
        e.preventDefault(); e.stopPropagation();
        if (panel?.busy) return;
        if (panel?.entry === entry) closePanel();
        else { closePanel(); openPanel(entry); }
      });
      mounted.set(row, entry); paint(entry);
    }
    if (panel && (!panel.entry.host.isConnected || !visible(panel.entry.host))) closePanel(false);
    else positionPanel();
  }

  function schedule() {
    if (!frame && !destroyed) frame = requestAnimationFrame(reconcile);
  }

  function visible(node) {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  function detectPanelColorMode(entry) {
    if (embedded) return embedded.theme && ['light', 'dark'].includes(embedded.theme) ? embedded.theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    for (let node = entry?.row; node; node = node.parentElement) {
      const rgba = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (!rgba || (rgba[3] ?? 1) < .95) continue;
      return rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722 < 150 ? 'dark' : 'light';
    }
    const docTheme = typeof document !== 'undefined'
      ? (document.documentElement?.getAttribute?.('data-theme') || document.documentElement?.dataset?.mode || (document.body?.classList?.contains('theme-light') ? 'light' : document.body?.classList?.contains('theme-dark') ? 'dark' : ''))
      : '';
    if (docTheme === 'light' || docTheme === 'dark') return docTheme;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function positionPanel() {
    if (!panel) return;
    if (embedded) {
      const mode = embedded.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      if (panel.root.getAttribute('data-color-mode') !== mode) panel.root.setAttribute('data-color-mode', mode);
      if (typeof syncAccent === 'function') syncAccent(panel.root, mode === 'dark');
      return;
    }
    // Foreground colors change when the host window becomes inactive.
    // Read the painted page background, whose luminance represents its theme.
    let mode = null;
    for (let node = panel.entry.row; node; node = node.parentElement) {
      const rgba = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (!rgba || (rgba[3] ?? 1) < .95) continue;
      mode = rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722 < 150 ? 'dark' : 'light';
      break;
    }
    mode ||= panel.root.getAttribute('data-color-mode') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (panel.root.getAttribute('data-color-mode') !== mode) panel.root.setAttribute('data-color-mode', mode);
    if (typeof syncAccent === 'function') syncAccent(panel.root, mode === 'dark');
    const anchor = panel.entry.host.getBoundingClientRect();
    const rect = panel.shell.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right + 10, innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(anchor.top - 12, innerHeight - rect.height - 8));
    panel.shell.style.left = `${left}px`; panel.shell.style.top = `${top}px`;
  }

  function updateDraft(target, patch) {
    target.draft = presentation ? presentation.draftTransition({ draft: target.draft, baseRevision: target.revision }, { type: 'patch', patch }).draft : { ...target.draft, ...patch };
    target.dirty = true;
    const draft = target.draft;
    target.progress.value = draft.progress ?? '';
    target.slider.value = draft.progress ?? 0;
    target.range.style.setProperty('--fill', `${draft.progress ?? 0}%`);
    target.range.style.setProperty('--mark', colors[draft.state] || colors.unfinished);
    for (const [state, button] of target.choices) button.setAttribute('aria-pressed', String(draft.state === state));
    rememberPanel(target);
  }

  function refreshPanel() {
    if (!panel) return;
    const target = panel, record = recordFor(target.entry.key);
    target.choices.get('pushed').hidden = target.projectGit?.hasRemote !== true;
    target.git.textContent = target.projectGit?.status === 'unknown' ? S('gitCheckUnavailable') : '';
    if (!target.busy && !target.dirty) {
      target.revision = snapshot.records[target.entry.key]?.revision ?? 0;
      target.draft = presentation ? presentation.draftTransition({}, { type: 'begin', record, revision: target.revision }).draft : { state: record?.state || 'unfinished', progress: record?.progress ?? null, note: record?.note || '' };
      target.note.value = target.draft.note;
      target.progress.value = target.draft.progress ?? '';
      target.slider.value = target.draft.progress ?? 0;
      target.range.style.setProperty('--fill', `${target.draft.progress ?? 0}%`);
      target.range.style.setProperty('--mark', colors[target.draft.state]);
      for (const [state, button] of target.choices) button.setAttribute('aria-pressed', String(target.draft.state === state));
    }
    makeRing(target.titleProgress, record, true);
    target.heading.setAttribute('aria-label', `${target.entry.title}, ${summary(target.entry.key)}`);
    target.statusLabel.textContent = record ? labels[record.state] : S('statusUnrecorded');
    target.statusDot.style.borderColor = record ? colors[record.state] : colors.unstarted;
    target.timestamp.textContent = record ? (ui?.formatDate ? ui.formatDate(record.updatedAt) : new Date(record.updatedAt).toLocaleString(activeLang === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : '';
    target.scoreNumber.textContent = record?.progress ?? '—';
    target.scoreUnit.hidden = false;
    target.meter.style.setProperty('--fill', `${record?.progress ?? 0}%`);
    target.meter.style.setProperty('--mark', record ? colors[record.state] : colors.unstarted);
    target.sourceLabel.textContent = record ? (record.source === 'analysis' ? S('sourceAuto') : S('sourceManual')) : '';
    const summaryText = record?.note || '';
    if (target.overviewSummary.textContent !== summaryText) {
      target.overviewSummary.textContent = summaryText;
      target.setSummaryExpanded(false);
    }
    target.summaryBlock.hidden = !summaryText;
    target.noteOpen.textContent = record?.note ? S('editLabel') : S('addLabel');
    target.analyze.disabled = presentation ? presentation.analysisDisabled(target.busy || target.capabilities?.analyze === false, target.analyzing, target.updateInfo?.update?.stage) : target.busy || target.analyzing || ['waiting', 'installing'].includes(target.updateInfo?.update?.stage);
    target.renderHistory?.();
    positionPanel();
    target.scheduleMarquees?.();
    if (target.restoreScroll != null && (target.mode === 'edit' || target.analysisState)) {
      target.body.scrollTop = target.restoreScroll; target.restoreScroll = null;
    }
  }

  async function save(patch = {}, reset = false, target = panel) {
    if (!target || target.busy) return false;
    const raw = target.progress.value.trim();
    const progress = raw === '' ? null : Number(raw);
    if (!reset && progress !== null && (!Number.isInteger(progress) || progress < 0 || progress > 100)) {
      target.error.textContent = S('invalidProgressError'); return false;
    }
    const record = reset ? null : { ...target.draft, progress, note: target.note.value, ...patch };
    target.busy = true; target.error.textContent = '';
    for (const control of target.controls) control.disabled = true;
    try {
      const state = await target.request('update', 7000, { expectedRevision: target.revision, record });
      target.dirty = false;
      target.conflict = false; target.resolveConflict.hidden = true;
      rememberPanel(target);
      // 保存成功即补读一次，并吸收保存期间到达的待刷新，避免 finally 再读一次。
      target.syncVersion = panelVersion(target.entry.key); target.syncPending = false;
      if (embedded && state) target.showHistory(state); else target.pollHistory?.();
      return true;
    } catch (error) {
      target.error.textContent = error.message;
      if ((error.code === 'REVISION_CONFLICT' || (!error.code && (error.message === '此会话已在其他窗口更新，请重新确认' || error.message === S('conflictDetectedFeedback')))) && target.dirty && !reset) {
        target.conflict = true;
        target.resolveConflict.hidden = false;
        rememberPanel(target);
      }
      return false;
    } finally {
      target.busy = false;
      for (const control of target.controls) control.disabled = false;
      if (target.syncPending && panel === target) syncPanel(target);
      if (panel === target) { target.analyze.disabled = target.analyzing; refreshPanel(); }
    }
  }

  async function rebaseDraft(target) {
    if (target.busy || !target.conflict) return;
    target.busy = true;
    for (const control of target.controls) control.disabled = true;
    try {
      const state = await target.request('analysis-state', 7000);
      target.revision = snapshot.records[target.entry.key]?.revision ?? 0;
      target.conflict = false; target.resolveConflict.hidden = true;
      target.error.textContent = S('conflictReloadedFeedback');
      target.showHistory?.(state);
      rememberPanel(target);
    } catch (error) {
      target.error.textContent = error.message;
    } finally {
      target.busy = false;
      for (const control of target.controls) control.disabled = false;
      if (panel === target) {
        if (target.syncPending) syncPanel(target);
        refreshPanel();
      }
    }
  }

  function cancelRead(requestId, request) {
    if (!['project-git', 'analysis-state', 'app-update-info'].includes(request.type) || !(embedded || harness?.supportsRequestCancellation)) return;
    try { send(JSON.stringify({ type: 'cancel-request', requestId: `${requestPrefix}:${++serial}`, cancelRequestId: requestId })); } catch { /* Local cleanup still runs if the host has disconnected. */ }
  }
  function closePanel(restoreFocus = true) {
    if (!panel || panel.busy) return;
    for (const [id, request] of pending) {
      if (request.key === panel.entry.key && ['project-git', 'analysis-state', 'app-update-info'].includes(request.type) && (embedded || harness?.supportsRequestCancellation)) {
        cancelRead(id, request); clearTimeout(request.timer); pending.delete(id);
        request.reject(Object.assign(new Error(S('cardRequestCancelled')), { code: 'REQUEST_CANCELLED' }));
      }
    }
    rememberPanel(panel);
    panelEvent('close', panel.entry);
    const target = panel; panel = null;
    clearTimeout(target.pollTimer); cancelAnimationFrame(target.marqueeFrame);
    clearTimeout(target.updateTimer); clearTimeout(target.manualCheckTimer);
    target.resizeObserver?.disconnect();
    target.root.remove(); target.entry.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && target.entry.host.isConnected) target.entry.button.focus();
  }

  function openPanel(entry) {
    if (panel) return;
    const root = document.createElement('div');
    const initialMode = detectPanelColorMode(entry);
    root.setAttribute('data-codex-session-status-panel', '');
    root.setAttribute('data-color-mode', initialMode);
    syncAccent(root, initialMode === 'dark');
    if (!embedded) root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    const shadow = root.attachShadow({ mode: 'open' });
    element('style', `
      :host{--accent:${currentAccentPalette.normal || '#0169cc'};--accent-hover:${currentAccentPalette.hover || '#005bb3'};--accent-pressed:${currentAccentPalette.pressed || '#004f9c'};--on-accent:${currentAccentPalette.onAccent || '#ffffff'};--ease-out:cubic-bezier(0.23,1,0.32,1);--ease-in-out:cubic-bezier(0.77,0,0.175,1);--ink:#e6edf3;--secondary:#a0a6ad;--muted:#828c96;--note:#bbc3ca;--track:#ffffff12;--line:#ffffff14;--input-border:#ffffff18;--input-bg:#ffffff03;--hover:#ffffff09;--selected:#ffffff10;--source-bg:#ffffff0a;--number-line:#ffffff25;--thumb:#ffffff;--danger:#ef7777;--error:#f7ad86;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);color-scheme:dark}
      *{box-sizing:border-box;scrollbar-width:none;-ms-overflow-style:none}*::-webkit-scrollbar{display:none;width:0;height:0}button,input,textarea{font:inherit}button{cursor:pointer}button,input,textarea{color:inherit}[hidden]{display:none!important}
      .shell{position:fixed;pointer-events:auto;width:${presentation?.layout.panelWidth || 340}px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);display:flex;flex-direction:column;overflow:hidden;--panel-bg:#0e1318;background:var(--panel-bg);border:1px solid #ffffff1c;border-radius:20px;box-shadow:0 16px 54px #0005;padding:22px 20px 14px}
      .shell:hover{--panel-bg:#1f242a}.title-heading{display:flex;flex:none;align-items:flex-start;gap:10px;margin-right:24px;border-radius:5px;outline-offset:4px}
      h2.title{font-size:24px;font-weight:650;line-height:1.3;letter-spacing:-.5px;margin:0;min-width:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
      .title-progress{display:flex;flex:none;width:32px;height:32px;margin-top:1px}.title-progress svg{width:32px;height:32px}.title-progress .progress-pie,.title-progress text{transition:opacity 160ms var(--ease-out),transform 160ms var(--ease-out);transform-origin:12px 12px}.title-progress text{opacity:0;transform:scale(.94)}.title-progress text.progress-unknown{opacity:1;transform:none}.title-heading:hover .progress-pie,.title-heading:focus-visible .progress-pie{opacity:0;transform:scale(.94)}.title-heading:hover text,.title-heading:focus-visible text{opacity:1;transform:scale(1)}
      .close{position:absolute;right:12px;top:7px;border:0;background:none;color:var(--secondary);font-size:0;width:28px;height:28px;padding:0;border-radius:6px;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out),background-color 150ms var(--ease-out)}.close:hover{color:var(--ink);background:var(--hover)}.close:active:not(:disabled){transform:scale(.94)}.close::before,.close::after{content:"";position:absolute;left:7px;top:13px;width:14px;height:1px;background:currentColor;transform:rotate(45deg)}.close::after{transform:rotate(-45deg)}
      .open-pane{position:absolute;right:44px;top:7px;border:0;background:none;color:var(--secondary);width:28px;height:28px;padding:0;border-radius:6px;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out),background-color 150ms var(--ease-out)}.open-pane:hover{color:var(--ink);background:var(--hover)}.open-pane:active:not(:disabled){transform:scale(.94)}.open-pane::before{content:"";position:absolute;left:7px;top:8px;width:14px;height:12px;border:1.3px solid currentColor;border-radius:3px;box-sizing:border-box}.open-pane::after{content:"";position:absolute;left:16px;top:8px;width:1.3px;height:12px;background:currentColor}.shell.has-open-pane .title-heading{margin-right:56px}.open-pane-tip{position:absolute;right:0;top:calc(100% + 6px);padding:5px 8px;border-radius:6px;background:var(--panel-bg);color:var(--ink);border:1px solid var(--line);box-shadow:0 4px 14px #0003;font-size:11px;line-height:1.4;white-space:nowrap;pointer-events:none;transform-origin:top right;opacity:0;transform:scale(.96) translateY(-2px);visibility:hidden;transition:opacity 150ms var(--ease-out),transform 150ms var(--ease-out),visibility 0s linear 150ms;z-index:2}.open-pane:is(:hover,:focus-visible) .open-pane-tip{opacity:1;transform:scale(1) translateY(0);visibility:visible;transition:opacity 150ms var(--ease-out) 160ms,transform 150ms var(--ease-out) 160ms,visibility 0s linear 160ms}
      .panel-body{overflow:auto;min-height:0;margin-top:23px;scrollbar-width:none;-ms-overflow-style:none}.panel-body::-webkit-scrollbar{display:none;width:0;height:0}.view{padding-bottom:4px}.status-line{display:flex;align-items:center;justify-content:space-between;gap:16px}.status-block{transform:translateY(2px);min-width:0;flex:1}.status-name{display:flex;align-items:center;gap:7px;line-height:18px;min-width:0}.status-name>span:last-child,.timestamp{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.state-dot{width:10px;height:10px;border:1.5px solid;border-radius:50%;flex:none;transition:border-color 180ms var(--ease-out)}.timestamp{font-size:11px;line-height:16px;color:var(--secondary);margin-top:2px;margin-left:17px}.score{display:flex;align-items:baseline;line-height:1;font-variant-numeric:tabular-nums;flex:none}.score-number{font-size:39px;font-weight:550;letter-spacing:-1px}.score-unit{font-size:15px;color:var(--secondary);margin-left:3px}
      .meter{height:4px;background:var(--track);border-radius:999px;margin:14px 0 10px;overflow:hidden}.meter::after{content:"";display:block;height:100%;width:var(--fill);background:var(--mark);border-radius:inherit;transition:width 220ms var(--ease-out),background-color 180ms var(--ease-out)}.totals-row{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--secondary)}.totals,.source-label{font-size:11px;font-weight:400;line-height:16px}.source-label{margin-left:auto;text-align:right;white-space:nowrap}.summary-block{position:relative;margin:16px 0;outline:none}.overview-summary{font-size:13px;line-height:1.65;color:var(--note);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}.summary-expand{position:absolute;right:0;bottom:0;border:0;background:linear-gradient(to right,transparent,var(--panel-bg) 18px);padding:0 0 0 22px;color:var(--secondary);font-size:12px;line-height:21.45px;white-space:nowrap;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out)}.summary-expand:hover{color:inherit}.summary-expand:active:not(:disabled){transform:scale(.97)}.summary-block.expanded .overview-summary{display:block;-webkit-line-clamp:unset}.summary-block.expanded .summary-expand{position:static;display:block;margin-left:auto;padding-left:0;background:none}
      .actions{display:flex;align-items:center;gap:14px;margin:18px 0 22px}.primary{border:0;background:var(--accent);color:var(--on-accent,#fff);border-radius:9px;padding:9px 14px;font-weight:550;min-height:36px;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 1px 2px rgba(0,0,0,.14);transition:transform 160ms var(--ease-out),background-color 160ms var(--ease-out),opacity 160ms var(--ease-out)}.primary:hover:not(:disabled){background:var(--accent-hover);color:var(--on-accent,#fff)}.primary:active:not(:disabled){background:var(--accent-pressed,var(--accent-hover));transform:scale(.97)}.text-button,.clear,.back{border:0;background:none;padding:0;color:var(--secondary);font-size:12px;white-space:nowrap;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out)}.text-button:hover,.back:hover{color:inherit}.text-button:active:not(:disabled),.back:active:not(:disabled),.clear:active:not(:disabled){transform:scale(.97)}.actions .clear{margin-left:auto;font-size:11px;color:var(--muted);white-space:nowrap}.actions .clear:hover{color:var(--danger)}.actions .clear{position:relative}.clear-tooltip{position:absolute;right:0;bottom:calc(100% + 8px);padding:6px 9px;border-radius:6px;background:var(--panel-bg);color:var(--secondary);border:1px solid var(--line);box-shadow:0 6px 18px rgba(0,0,0,.22);font-size:11px;white-space:nowrap;pointer-events:none;transform-origin:bottom right;opacity:0;transform:scale(.96) translateY(3px);visibility:hidden;transition:opacity 150ms var(--ease-out),transform 150ms var(--ease-out),visibility 0s linear 150ms;z-index:2}.clear:is(:hover,:focus-visible) .clear-tooltip{opacity:1;transform:scale(1) translateY(0);visibility:visible;transition:opacity 150ms var(--ease-out) 160ms,transform 150ms var(--ease-out) 160ms,visibility 0s linear 160ms}.section-head{border-top:1px solid var(--line);padding-top:16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}.section-head h3{font-size:12px;font-weight:550;margin:0}.remaining-toggle{border:0;background:none;padding:0;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out)}.remaining-toggle:active:not(:disabled){transform:scale(.97)}.row-detail{font-size:12px;font-weight:400;line-height:18px;color:var(--secondary);white-space:nowrap}
      .task-row{position:relative;display:flex;gap:9px;align-items:flex-start;padding:9px 0;overflow:hidden;isolation:isolate}.task-dot{width:12px;height:12px;border:1.3px solid #c89b38;border-radius:50%;margin-top:4px;flex:none;transition:transform 180ms var(--ease-out),border-color 180ms var(--ease-out),background-color 180ms var(--ease-out)}.task-row[data-status=done] .task-dot{border-color:#548eea;background:#548eea22}.task-content{min-width:0;flex:1}.task-title{width:100%;overflow:hidden;mask-image:linear-gradient(to right,#000 calc(100% - 12px),transparent)}.task-track{display:flex;width:max-content;transform:translateX(0);transition:transform .22s ease-out}.task-copy{white-space:nowrap;flex:none}.task-row:is(:hover,:focus-within) .task-title.overflowing .task-track{transform:translateX(calc(-1 * var(--travel)));transition-duration:var(--duration,4s);transition-timing-function:linear;will-change:transform}.task-meta{font-size:10px;color:var(--secondary);margin-top:3px}.task-source{position:absolute;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:flex-end;padding-left:28px;background:linear-gradient(to right,transparent,var(--panel-bg) 25px);opacity:0;pointer-events:none;transform:translateX(4px);transition:opacity 150ms var(--ease-out),transform 150ms var(--ease-out)}.task-source button{border:0;border-radius:6px;background:var(--source-bg);color:inherit;padding:5px 7px;font-size:11px;white-space:nowrap;transition:transform 160ms var(--ease-out),background-color 150ms var(--ease-out)}.task-source button:active:not(:disabled){transform:scale(.96)}.task-row:hover .task-source,.task-row:focus-within .task-source{opacity:1;pointer-events:auto;transform:none}.task-row:focus-visible{outline:1px solid var(--accent);outline-offset:1px}
      @media(prefers-reduced-motion:reduce){.task-row .task-title.overflowing .task-track{transform:none;transition:none}.task-title{overflow:auto}.primary:active:not(:disabled),.text-button:active:not(:disabled),.back:active:not(:disabled),.clear:active:not(:disabled),.choice:active:not(:disabled),.quiet-row:active:not(:disabled),.range-input:hover::-webkit-slider-thumb,.range-input:active::-webkit-slider-thumb{transform:none}}
      @media(hover:none){.task-source{opacity:1;pointer-events:auto;transform:none}}
      .empty{font-size:12px;color:var(--secondary);padding:13px 0}.quiet-row{border:0;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;width:100%;background:none;color:inherit;padding:15px 0;text-align:left;font-size:12px;transition:transform 160ms var(--ease-out),background-color 150ms var(--ease-out)}.quiet-row:active:not(:disabled){transform:scale(.988)}.quiet-row span:last-child{color:var(--secondary);transition:transform 160ms var(--ease-out),color 150ms var(--ease-out)}.quiet-row:hover span:last-child{transform:translateX(2px)}.overview-bottom{margin-top:13px}.view-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.view-heading h3{font-size:14px;font-weight:550;margin:0}.choice{display:flex;align-items:center;gap:10px;width:100%;padding:8px 9px;border:0;border-radius:7px;background:none;color:inherit;text-align:left;transition:transform 160ms var(--ease-out),background-color 150ms var(--ease-out)}.choice:hover{background:var(--hover)}.choice:active:not(:disabled){transform:scale(.988)}.choice[aria-pressed=true]{background:var(--selected)}.dot{width:12px;height:12px;border:1.6px solid var(--mark);border-radius:50%;flex:none;transition:background-color 180ms var(--ease-out),border-color 180ms var(--ease-out)}.choice[aria-pressed=true] .dot{background:var(--mark);box-shadow:inset 0 0 0 2px var(--panel-bg)}
      .progress-section{margin-top:20px}.progress-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.label{font-size:11px;color:var(--secondary)}.number-wrap{display:flex;align-items:center;gap:5px;color:var(--secondary)}.progress-number{appearance:textfield;color:var(--ink);width:65px;padding:2px 3px 4px;background:none;border:0;border-bottom:1px solid var(--number-line);font-size:27px;font-weight:550;text-align:right;font-variant-numeric:tabular-nums}.progress-number::-webkit-inner-spin-button{appearance:none}.range{position:relative;height:48px;margin-top:2px;--mark:#c89b38}.range-track{position:absolute;left:7px;right:7px;top:9px;height:6px;border-radius:999px;background:linear-gradient(to right,var(--range-fill,var(--mark)) var(--fill),var(--track) var(--fill));pointer-events:none;transition:background-color 160ms var(--ease-out)}.range.is-dragging .range-track{transition:none}.range-input{position:relative;appearance:none;width:100%;height:24px;background:transparent;margin:0;display:block;padding:0;cursor:pointer}.range-input::-webkit-slider-runnable-track{height:6px;background:transparent}.range-input::-webkit-slider-thumb{appearance:none;width:16px;height:16px;margin-top:-5px;background:var(--thumb);border:.5px solid rgba(0,0,0,.14);border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.28),0 0 0 .5px rgba(0,0,0,.08);transition:transform 150ms var(--ease-out),box-shadow 150ms var(--ease-out)}.range-input:hover::-webkit-slider-thumb{transform:scale(1.06)}.range-input:active::-webkit-slider-thumb{transform:scale(1.1);box-shadow:0 2px 6px rgba(0,0,0,.34),0 0 0 1px rgba(0,0,0,.12)}.range-nodes{position:absolute;left:7px;right:7px;top:0;pointer-events:none}.range-node{position:absolute;left:var(--at);top:8px;width:0;font-size:10px;font-weight:500;opacity:.78;color:var(--secondary);font-variant-numeric:tabular-nums}.range-node::before{display:none}.range-node-label{position:absolute;top:20px;left:0;transform:translateX(-50%)}.range-node:first-child .range-node-label{transform:none}.range-node:last-child .range-node-label{transform:translateX(-100%)}.unknown-row{display:flex;justify-content:flex-end;margin:2px 0 18px}.unknown{font-size:11px}
      .note-label{display:block;font-size:11px;color:var(--secondary);margin-bottom:8px}textarea{display:block;width:100%;resize:vertical;min-height:66px;max-height:140px;background:var(--input-bg);color:inherit;border:1px solid var(--input-border);border-radius:8px;padding:9px;line-height:1.6;font-size:12px;scrollbar-width:none;-ms-overflow-style:none}textarea::-webkit-scrollbar{display:none;width:0;height:0}textarea::placeholder{color:var(--muted)}.edit-actions{display:flex;justify-content:flex-end;gap:18px;align-items:center;padding:21px 0 16px}.git{font-size:11px;color:var(--secondary)}.analysis-message{font-size:11px;color:var(--secondary);margin:0 0 13px}.analysis-message:empty,.error:empty,.git:empty{display:none}.error{flex:none;font-size:12px;color:var(--error);padding-top:10px;white-space:pre-wrap}button:disabled,input:disabled,textarea:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
      .shell textarea:focus-visible{outline:none}
      .app-update{margin-top:3px;padding:10px 11px;background:var(--hover);border:1px solid var(--line);border-radius:10px}.app-update-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.app-update-label{font-size:12px;line-height:18px;color:var(--ink);min-width:0;overflow-wrap:anywhere}.app-update-button{flex:none;padding:5px 10px;min-height:28px;border-radius:7px;font-size:11px}.app-update-detail{margin-top:7px;font-size:11px;line-height:1.6;color:var(--secondary);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.app-update[data-failed=true] .app-update-detail{color:var(--error)}
      .version-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0 2px;font-size:11px;line-height:16px;color:var(--muted)}.version-bar-text{min-width:0;overflow-wrap:anywhere}.version-bar[data-failed=true] .version-bar-text{color:var(--error)}.version-check-button{flex:none;font-size:11px;color:var(--muted)}.version-check-button:hover:not(:disabled){color:inherit}
      :host([data-color-mode=light]){--ink:#22272e;--secondary:#576374;--muted:#667383;--note:#46515f;--track:#dfe4ea;--line:#dfe4ea;--input-border:#c7d0da;--input-bg:#f7f9fb;--hover:#f0f3f6;--selected:#e9edf2;--source-bg:#e9eef4;--number-line:#b6c1ce;--thumb:#ffffff;--danger:#bf2f3a;--error:#b13a2d;color:var(--ink);color-scheme:light}
      :host([data-color-mode=light]) .shell{--panel-bg:#fff;border-color:#dfe4ea;box-shadow:0 14px 45px #26344520}
      :host([data-color-mode=light]) .shell:hover{--panel-bg:#f5f6f7}
      :host([data-color-mode=light]) .range{--range-fill:color-mix(in srgb,var(--mark) 85%,#000)}
      :host([data-color-mode=light]) .meter::after{background:color-mix(in srgb,var(--mark) 85%,#000)}
      @media(prefers-color-scheme:light){
        :host(:not([data-color-mode=dark])){--ink:#22272e;--secondary:#576374;--muted:#667383;--note:#46515f;--track:#dfe4ea;--line:#dfe4ea;--input-border:#c7d0da;--input-bg:#f7f9fb;--hover:#f0f3f6;--selected:#e9edf2;--source-bg:#e9eef4;--number-line:#b6c1ce;--thumb:#ffffff;--danger:#bf2f3a;--error:#b13a2d;color:var(--ink);color-scheme:light}
        :host(:not([data-color-mode=dark])) .shell{--panel-bg:#fff;border-color:#dfe4ea;box-shadow:0 14px 45px #26344520}
        :host(:not([data-color-mode=dark])) .shell:hover{--panel-bg:#f5f6f7}
        :host(:not([data-color-mode=dark])) .range{--range-fill:color-mix(in srgb,var(--mark) 85%,#000)}
        :host(:not([data-color-mode=dark])) .meter::after{background:color-mix(in srgb,var(--mark) 85%,#000)}
      }
    `, shadow);
    if (embedded) element('style', '.shell,:host([data-color-mode=light]) .shell,:host(:not([data-color-mode=dark])) .shell{box-shadow:none}.shell{position:relative;max-width:100%;max-height:none}.panel-body{overflow:visible}', shadow);
    const shell = element('div', null, shadow, 'shell');
    shell.setAttribute('role', embedded ? 'region' : 'dialog'); shell.setAttribute('aria-label', S('panelAriaPattern', { title: entry.title }));
    const close = embedded ? null : element('button', '×', shell, 'close'); close?.setAttribute('aria-label', S('close'));
    // 宿主支持时，在关闭按钮左侧提供「在侧栏打开」：把卡片交给宿主的常驻侧栏面板。
    const openPane = harness?.openPane ? element('button', null, shell, 'open-pane') : null;
    let openPaneTip = null;
    if (openPane) {
      shell.classList.add('has-open-pane'); openPane.setAttribute('aria-label', S('openInSidebar'));
      openPaneTip = element('span', S('openInSidebar'), openPane, 'open-pane-tip');
      openPaneTip.setAttribute('role', 'tooltip');
    }
    const heading = element('div', null, shell, 'title-heading'); heading.tabIndex = 0;
    const titleProgress = element('span', null, heading, 'title-progress');
    element('h2', entry.title, heading, 'title');
    const body = element('div', null, shell, 'panel-body');
    const overview = element('div', null, body, 'view overview');
    const statusLine = element('div', null, overview, 'status-line');
    const statusBlock = element('div', null, statusLine, 'status-block');
    const statusName = element('div', null, statusBlock, 'status-name');
    const statusDot = element('span', null, statusName, 'state-dot');
    const statusLabel = element('span', null, statusName);
    const timestamp = element('div', null, statusBlock, 'timestamp');
    const score = element('div', null, statusLine, 'score');
    const scoreNumber = element('span', null, score, 'score-number');
    const scoreUnit = element('span', '%', score, 'score-unit');
    const meter = element('div', null, overview, 'meter');
    const totalsRow = element('div', null, overview, 'totals-row');
    const totals = element('span', S('totalsEmpty'), totalsRow, 'totals');
    const sourceLabel = element('span', null, totalsRow, 'source-label');
    const summaryBlock = element('div', null, overview, 'summary-block'); summaryBlock.tabIndex = 0;
    const overviewSummary = element('div', null, summaryBlock, 'overview-summary');
    const summaryExpand = element('button', S('expandAll'), summaryBlock, 'summary-expand');
    summaryExpand.hidden = true; summaryExpand.setAttribute('aria-expanded', 'false');
    const actions = element('div', null, overview, 'actions');
    const analyze = element('button', S('btnUpdate'), actions, 'primary analyze');
    const editOpen = element('button', S('btnAdjust'), actions, 'text-button edit-open');
    const clear = element('button', S('btnClear'), actions, 'clear');
    clear.setAttribute('aria-label', S('btnClear'));
    const clearTip = element('span', S('clearTooltip'), clear, 'clear-tooltip');
    clearTip.setAttribute('role', 'tooltip');
    const sectionHead = element('div', null, overview, 'section-head');
    const tasksHeading = element('h3', S('remainingHeadingPattern', { count: 0 }), sectionHead);
    const remainingToggle = element('button', null, sectionHead, 'remaining-toggle row-detail');
    remainingToggle.hidden = true; remainingToggle.setAttribute('aria-expanded', 'false');
    const currentTasks = element('div', null, overview, 'current-tasks');
    const bottom = element('div', null, overview, 'overview-bottom');
    const historyOpen = element('button', null, bottom, 'quiet-row history-open'); const historyRowTitle = element('span', S('completedHeading'), historyOpen);
    const historyCount = element('span', S('countArrowPattern', { count: 0 }), historyOpen, 'row-detail');
    const noteRow = element('button', null, bottom, 'quiet-row note-open'); const noteRowTitle = element('span', S('notesLabel'), noteRow);
    const noteOpen = element('span', S('addLabel'), noteRow);
    const timelineOpen = embedded ? element('button', S('timelineLink'), bottom, 'quiet-row timeline-open') : null;
    const appUpdate = element('div', null, bottom, 'app-update'); appUpdate.hidden = true;
    const appUpdateRow = element('div', null, appUpdate, 'app-update-row');
    const appUpdateLabel = element('span', null, appUpdateRow, 'app-update-label'); appUpdateLabel.setAttribute('role', 'status');
    const appUpdateButton = element('button', S('upgradeBtn'), appUpdateRow, 'primary app-update-button');
    const appUpdateDetail = element('div', null, appUpdate, 'app-update-detail'); appUpdateDetail.hidden = true;
    const versionBar = element('div', null, overview, 'version-bar'); versionBar.hidden = true;
    const versionBarText = element('span', null, versionBar, 'version-bar-text'); versionBarText.setAttribute('role', 'status');
    const checkUpdateButton = element('button', S('checkUpdateBtn'), versionBar, 'text-button version-check-button');
    const edit = element('div', null, body, 'view edit-view'); edit.hidden = true;
    const editHeading = element('div', null, edit, 'view-heading'); const editHeadingTitle = element('h3', S('editHeading'), editHeading);
    const choices = new Map(), choiceLabels = new Map(), controls = [];
    for (const [state, label] of Object.entries(labels)) {
      const button = element('button', null, edit, 'choice'); button.style.setProperty('--mark', colors[state]);
      element('span', null, button, 'dot'); choiceLabels.set(state, element('span', label, button)); button.setAttribute('aria-pressed', 'false');
      choices.set(state, button); controls.push(button); if (state === 'pushed') button.hidden = true;
      button.onclick = () => updateDraft(target, { state, progress: state === 'unstarted' ? 0 : state === 'unfinished'
        ? target.draft.state === 'unfinished' ? target.draft.progress : null : 100 });
      button.onkeydown = event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const buttons = [...choices.values()].filter(item => !item.hidden);
        buttons[(buttons.indexOf(button) + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
      };
    }
    const progressSection = element('div', null, edit, 'progress-section');
    const progressHead = element('div', null, progressSection, 'progress-head'); const progressHeadLabel = element('label', S('progressLabel'), progressHead, 'label');
    const numberWrap = element('div', null, progressHead, 'number-wrap');
    const progress = element('input', null, numberWrap, 'progress-number'); progress.type = 'number'; progress.min = '0'; progress.max = '100'; progress.step = '1'; progress.placeholder = '—'; progress.setAttribute('aria-label', S('progressLabel')); element('span', '%', numberWrap);
    const range = element('div', null, progressSection, 'range'); element('div', null, range, 'range-track');
    const nodes = element('div', null, range, 'range-nodes'); nodes.setAttribute('aria-hidden', 'true');
    for (const value of [0, 25, 50, 75, 100]) { const node = element('span', null, nodes, 'range-node'); node.style.setProperty('--at', `${value}%`); element('span', String(value), node, 'range-node-label'); }
    const slider = element('input', null, range, 'range-input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.setAttribute('aria-label', S('sliderAriaLabel'));
    const unknownRow = element('div', null, progressSection, 'unknown-row'); const unknown = element('button', S('clearValueBtn'), unknownRow, 'text-button unknown');
    const noteLabel = element('label', S('notesLabel'), edit, 'note-label');
    const note = element('textarea', null, edit); note.maxLength = 4000; note.placeholder = S('notePlaceholder'); note.setAttribute('aria-label', S('noteAriaLabel'));
    noteLabel.htmlFor = note.id = `session-status-note-${serial}`;
    const git = element('div', null, edit, 'git');
    const editActions = element('div', null, edit, 'edit-actions');
    const cancel = element('button', S('cancelBtn'), editActions, 'text-button cancel');
    const submit = element('button', S('saveBtn'), editActions, 'primary save-record');
    const history = element('div', null, body, 'view history-view'); history.hidden = true;
    const historyHeading = element('div', null, history, 'view-heading'); const historyHeadingTitle = element('h3', S('completedHeading'), historyHeading);
    const back = element('button', S('backLabel'), historyHeading, 'back');
    const historyList = element('div', null, history, 'history-list');
    const timelineView = embedded ? element('div', null, body, 'view history-view') : null;
    let timelineList, timelineHeadingTitle, timelineBackBtn;
    if (timelineView) {
      timelineView.hidden = true;
      const title = element('div', null, timelineView, 'view-heading'); timelineHeadingTitle = element('h3', S('timelineHeading'), title);
      timelineBackBtn = element('button', S('backLabel'), title, 'back');
      timelineBackBtn.onclick = () => target.setView('overview');
      timelineList = element('div', null, timelineView, 'history-list');
    }
    const analysisMessage = element('div', null, body, 'analysis-message'); analysisMessage.setAttribute('role', 'status');
    const error = element('div', null, shell, 'error'); error.setAttribute('role', 'status');
    const resolveConflict = element('button', S('resolveConflictBtn'), shell, 'text-button'); resolveConflict.hidden = true;
    controls.push(note, progress, slider, unknown, cancel, submit, clear, analyze, editOpen, resolveConflict);
    panel = { entry, root, shell, body, heading, titleProgress, choices, note, progress, slider, range, git, error, resolveConflict, controls,
      statusLabel, statusDot, timestamp, scoreNumber, scoreUnit, meter, sourceLabel, overviewSummary, summaryBlock, noteOpen,
      totals, analyze, historyList, dirty: false, busy: false, analyzing: false, revision: 0, mode: 'overview' };
    const target = panel;
    target.applyLocale = () => {
      shell.setAttribute('aria-label', S('panelAriaPattern', { title: entry.title }));
      close?.setAttribute('aria-label', S('close'));
      if (openPane) {
        openPane.setAttribute('aria-label', S('openInSidebar'));
        if (openPaneTip) openPaneTip.textContent = S('openInSidebar');
      }
      summaryExpand.textContent = target.summaryExpanded ? S('collapse') : S('expandAll');
      analyze.textContent = target.analyzing ? S('btnUpdating') : S('btnUpdate');
      editOpen.textContent = S('btnAdjust');
      clear.textContent = S('btnClear');
      clear.setAttribute('aria-label', S('btnClear'));
      clearTip.textContent = S('clearTooltip');
      historyRowTitle.textContent = S('completedHeading');
      noteRowTitle.textContent = S('notesLabel');
      if (timelineOpen) timelineOpen.textContent = S('timelineLink');
      editHeadingTitle.textContent = S('editHeading');
      for (const [state, labelEl] of choiceLabels) labelEl.textContent = labels[state];
      progressHeadLabel.textContent = S('progressLabel');
      progress.setAttribute('aria-label', S('progressLabel'));
      slider.setAttribute('aria-label', S('sliderAriaLabel'));
      unknown.textContent = S('clearValueBtn');
      noteLabel.textContent = S('notesLabel');
      note.placeholder = S('notePlaceholder');
      note.setAttribute('aria-label', S('noteAriaLabel'));
      cancel.textContent = S('cancelBtn');
      submit.textContent = S('saveBtn');
      historyHeadingTitle.textContent = S('completedHeading');
      back.textContent = S('backLabel');
      if (timelineHeadingTitle) timelineHeadingTitle.textContent = S('timelineHeading');
      if (timelineBackBtn) timelineBackBtn.textContent = S('backLabel');
      resolveConflict.textContent = S('resolveConflictBtn');
      target.tasksKey = null; target.completedKey = null; target.timelineRevision = null;
      if (target.updateInfo || target.updateChecking || target.manualCheckStatus) showAppUpdate(target.updateInfo);
      else checkUpdateButton.textContent = S('checkUpdateBtn');
    };
    target.capabilities = embedded?.session?.capabilities || null;
    panelEvent('open', entry);
    target.request = (type, timeout, extra = {}) => new Promise((resolve, reject) => {
      const requestId = `${requestPrefix}:${++serial}`;
      const timer = setTimeout(() => { cancelRead(requestId, { type }); pending.delete(requestId); const error = new Error(S('cardRequestTimeout')); error.code = 'STATUS_REQUEST_TIMEOUT'; reject(error); }, timeout);
      pending.set(requestId, { resolve, reject, timer, type, key: entry.key });
      try { send(JSON.stringify({ type, requestId, key: entry.key, ...extra })); }
      catch { clearTimeout(timer); pending.delete(requestId); const error = new Error(S('cardStatusDisconnected')); error.code = 'STATUS_SEND_FAILED'; reject(error); }
    });
    resolveConflict.onclick = () => rebaseDraft(target);
    const showAppUpdate = info => {
      target.updateInfo = info;
      const options = {
        starting: target.upgradeStarting,
        checking: target.updateChecking,
        connectionError: target.updateConnectionError,
        manualCheckStatus: target.manualCheckStatus,
        checkError: target.manualCheckError,
      };
      const banner = presentation?.updateBannerState
        ? presentation.updateBannerState(info, strings, options)
        : (() => {
            const update = info?.update;
            const stage = update?.stage;
            const stages = strings.updateStages || { queued: '正在准备升级', checking: '正在检查版本', downloading: '正在下载新版本', waiting: '等待当前分析结束', installing: '正在升级' };
            const active = Boolean(stages[stage]) || Boolean(options.starting);
            const completed = stage === 'completed' && Date.now() - Date.parse(update.updatedAt) < 60000;
            const failed = stage === 'failed';
            const visible = Boolean(info?.available || active || failed || completed);
            const command = info?.command || 'npx agent-things@latest';
            return {
              visible,
              active,
              completed,
              failed,
              buttonDisabled: active || completed,
              label: active ? stages[stage] || stages.queued : failed ? S('updateFailedLabel') : completed
                ? S('upgradedToPattern', { version: update?.currentVersion }) : S('updateAvailablePattern', { version: info?.latestVersion }),
              buttonText: active ? S('pleaseWait') : completed ? S('completedShort') : failed ? S('retryBtn') : S('upgradeBtn'),
              detail: options.connectionError ? `${S('reconnectHint')}\n${S('terminalUpgradePrefix')}${command}`
                : failed ? `${update?.error || ''}\n${S('terminalUpgradePrefix')}${command}` : completed && update?.reconnectMcp ? S('reconnectMcpHint') : '',
              versionText: options.manualCheckStatus === 'failed' && !info?.unsupported
                ? `${S('checkUpdateFailedLabel')}${options.checkError ? `: ${options.checkError}` : ''}`
                : (options.manualCheckStatus === 'latest' && !info?.unsupported && info?.currentVersion ? S('alreadyLatestPattern', { version: info.currentVersion }) : (info?.currentVersion ? `v${info.currentVersion}` : '')),
              showVersionBar: !visible,
              showCheckButton: !info?.unsupported,
              checkDisabled: Boolean(options.checking || info?.unsupported),
              checkFailed: !visible && !info?.unsupported && options.manualCheckStatus === 'failed',
              checkButtonText: options.checking ? S('checkingUpdateShort') : S('checkUpdateBtn'),
            };
          })();
      appUpdate.hidden = !banner.visible;
      appUpdate.setAttribute('data-failed', String(banner.failed));
      appUpdateLabel.textContent = banner.label;
      appUpdateButton.textContent = banner.buttonText;
      appUpdateButton.disabled = banner.buttonDisabled;
      appUpdateDetail.textContent = banner.detail;
      appUpdateDetail.hidden = !appUpdateDetail.textContent;
      versionBar.hidden = !(banner.showVersionBar && (info || banner.checking || banner.checkFailed));
      versionBar.setAttribute('data-failed', String(banner.checkFailed));
      versionBarText.textContent = banner.versionText;
      checkUpdateButton.hidden = banner.showCheckButton === false || Boolean(info?.unsupported);
      checkUpdateButton.textContent = banner.checkButtonText;
      checkUpdateButton.disabled = banner.checkDisabled;
      refreshPanel();
      return banner.active;
    };
    const pollAppUpdate = async () => {
      clearTimeout(target.updateTimer);
      try {
        const info = await target.request('app-update-info', 12000);
        if (panel !== target) return;
        target.updateConnectionError = null;
        if (info?.available) {
          target.manualCheckStatus = '';
          target.manualCheckError = '';
        }
        const active = showAppUpdate(info);
        target.updateTimer = setTimeout(pollAppUpdate, active ? 2000 : 60000);
      } catch (error) {
        if (panel !== target) return;
        target.updateConnectionError = error.message;
        if (target.updateInfo) showAppUpdate(target.updateInfo);
        target.updateTimer = setTimeout(pollAppUpdate, 2000);
      }
    };
    checkUpdateButton.onclick = async () => {
      if (target.updateChecking || checkUpdateButton.disabled) return;
      clearTimeout(target.updateTimer);
      clearTimeout(target.manualCheckTimer);
      target.updateChecking = true;
      target.manualCheckStatus = '';
      target.manualCheckError = '';
      showAppUpdate(target.updateInfo);
      try {
        const info = await target.request('app-update-info', 12000, { force: true });
        if (panel !== target) return;
        target.updateChecking = false;
        target.updateConnectionError = null;
        if (info?.checkError && !info?.available) {
          target.manualCheckStatus = 'failed';
          target.manualCheckError = info.checkError;
        } else if (!info?.available && !info?.unsupported) {
          target.manualCheckStatus = 'latest';
          target.manualCheckTimer = setTimeout(() => {
            if (panel !== target || target.manualCheckStatus !== 'latest') return;
            target.manualCheckStatus = '';
            showAppUpdate(target.updateInfo);
          }, 5000);
        }
        const active = showAppUpdate(info);
        target.updateTimer = setTimeout(pollAppUpdate, active ? 2000 : 60000);
      } catch (error) {
        if (panel !== target) return;
        target.updateChecking = false;
        target.manualCheckStatus = 'failed';
        target.manualCheckError = error.message;
        showAppUpdate(target.updateInfo);
        target.updateTimer = setTimeout(pollAppUpdate, 60000);
      }
    };
    appUpdateButton.onclick = async () => {
      if (appUpdateButton.disabled) return;
      clearTimeout(target.updateTimer);
      target.upgradeStarting = true;
      showAppUpdate(target.updateInfo);
      try {
        const info = await target.request('app-update-start', 12000);
        if (panel !== target) return;
        target.updateConnectionError = null;
        target.upgradeStarting = false;
        showAppUpdate(info);
      } catch (error) {
        if (panel !== target) return;
        target.upgradeStarting = false;
        target.updateConnectionError = error.message;
        showAppUpdate(target.updateInfo);
      }
      if (panel === target) target.updateTimer = setTimeout(pollAppUpdate, 1000);
    };
    target.scheduleMarquees = () => {
      cancelAnimationFrame(target.marqueeFrame);
      target.marqueeFrame = requestAnimationFrame(() => {
        if (panel !== target) return;
        if (target.mode === 'overview' && !target.summaryExpanded) summaryExpand.hidden = overviewSummary.scrollHeight <= overviewSummary.clientHeight + 1;
        for (const title of shadow.querySelectorAll('.task-title')) {
          if (!title.clientWidth) continue;
          const width = title.firstElementChild.firstElementChild.getBoundingClientRect().width;
          const maskWidth = title.closest('.task-row').querySelector('.task-source')?.offsetWidth || 0;
          const distance = Math.max(0, width - title.clientWidth + maskWidth + 8);
          title.classList.toggle('overflowing', distance > 1);
          title.style.setProperty('--travel', `${distance}px`);
          title.style.setProperty('--duration', `${Math.max(1, distance / 26)}s`);
        }
      });
    };
    target.setSummaryExpanded = expanded => {
      target.summaryExpanded = expanded;
      summaryBlock.classList.toggle('expanded', expanded);
      summaryExpand.textContent = expanded ? S('collapse') : S('expandAll');
      summaryExpand.setAttribute('aria-expanded', String(expanded));
      positionPanel(); target.scheduleMarquees();
    };
    summaryExpand.onclick = () => { summaryExpand.focus({ preventScroll: true }); target.setSummaryExpanded(!target.summaryExpanded); };
    summaryBlock.addEventListener('focusout', event => { if (!summaryBlock.contains(event.relatedTarget)) target.setSummaryExpanded(false); });
    target.resizeObserver = new ResizeObserver(target.scheduleMarquees); target.resizeObserver.observe(body);
    target.setView = mode => {
      target.mode = mode; overview.hidden = mode !== 'overview'; edit.hidden = mode !== 'edit'; history.hidden = mode !== 'history';
      if (timelineView) timelineView.hidden = mode !== 'timeline';
      body.scrollTop = 0; target.error.textContent = '';
      if (mode !== 'edit') { target.conflict = false; resolveConflict.hidden = true; }
      refreshPanel();
      rememberPanel(target);
    };
    const cancelEdit = () => { target.dirty = false; target.setView('overview'); editOpen.focus(); };
    target.cancelEdit = cancelEdit;
    editOpen.onclick = () => { target.setView('edit'); (choices.get(target.draft.state) || choices.values().next().value).focus(); };
    noteRow.onclick = () => { target.setView('edit'); note.focus(); };
    historyOpen.onclick = () => target.setView('history'); back.onclick = () => target.setView('overview'); cancel.onclick = cancelEdit;
    if (timelineOpen) timelineOpen.onclick = () => target.setView('timeline');
    remainingToggle.onclick = () => { target.remainingExpanded = !target.remainingExpanded; refreshPanel(); };
    const locate = async source => {
      if (target.capabilities?.locate === false) { analysisMessage.textContent = S('locateHostDisconnected'); return; }
      if (embedded) {
        if (!source?.turnId || !source?.itemId) { analysisMessage.textContent = S('locateNoSource'); return; }
        analysisMessage.textContent = S('locatingMessage');
        try {
          const result = await target.request('locate-source', 14000, { source: { turnId: source.turnId, itemId: source.itemId } });
          analysisMessage.textContent = result?.message || S('locatedMessage');
        } catch (error) { analysisMessage.textContent = error.message; }
        return;
      }
      if (!source?.turnId || !source?.itemId) { analysisMessage.textContent = S('locateNoSource'); return; }
      const harness = window.__sessionStatusHarness;
      if (harness?.locate) {
        try { await harness.locate({ entry, source, analysisMessage, request: target.request }); }
        catch (error) { analysisMessage.textContent = error.message; }
        return;
      }
      const row = entry.row;
      if (row.getAttribute('data-app-action-sidebar-thread-selected') !== 'true') {
        const trigger = row.querySelector('[data-thread-title-trigger]');
        if (!trigger) { analysisMessage.textContent = S('locateOpenFailed'); return; } trigger.click();
      }
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if (row.getAttribute('data-app-action-sidebar-thread-selected') === 'true') {
          const message = [...document.querySelectorAll('[data-content-search-unit-key]')].find(node => node.getAttribute('data-content-search-unit-key') === `${source.turnId}:${source.itemId}`);
          if (message) { message.scrollIntoView({ block: 'center', behavior: 'smooth' }); const previous = message.style.outline; const highlight = `2px solid ${currentAccent || '#0169cc'}`; message.style.outline = highlight; setTimeout(() => { if (message.style.outline === highlight || message.style.outline.startsWith('2px solid')) message.style.outline = previous; }, 3000); analysisMessage.textContent = S('locatedMessage'); return; }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      try { await target.request('locate-source', 30000, { source }); analysisMessage.textContent = S('locatedMessage'); }
      catch (error) { analysisMessage.textContent = error.message; }
    };
    const renderTask = (task, sources, parent) => {
      const row = element('div', null, parent, 'task-row'); row.dataset.status = task.status; row.tabIndex = 0;
      element('span', null, row, 'task-dot'); const content = element('div', null, row, 'task-content');
      const title = element('div', null, content, 'task-title'); title.title = task.title;
      const track = element('div', null, title, 'task-track');
      const text = task.title || task.summary;
      element('span', text, track, 'task-copy');
      element('div', taskLabels[task.status] || S('taskUnknown'), content, 'task-meta');
      const ref = task.evidenceRefs?.find(value => sources?.[value]?.turnId);
      if (ref) { const mask = element('div', null, row, 'task-source'); const link = element('button', S('viewSource'), mask); link.setAttribute('aria-label', `${S('viewSourceAriaPrefix')}${task.title}`); link.onclick = () => locate(sources[ref]); }
    };
    target.renderHistory = () => {
      const state = target.analysisState; if (!state) return;
      if (timelineList && target.timelineRevision !== state.revision) {
        target.timelineRevision = state.revision;
        timelineList.replaceChildren();
        for (const item of [...(state.timeline || [])].reverse()) {
          const date = new Date(item.requestedAt).toLocaleString(activeLang === 'en' ? 'en-US' : 'zh-CN');
          const progress = item.record?.progress ?? item.progress;
          const label = item.source === 'analysis' ? S('timelineAnalysis') : S('timelineManual');
          const value = item.status === 'failed' ? S('analysisFailedWord') : item.status === 'pending' ? S('analyzingWord') : progress == null ? S('unrecordedShort') : `${progress}%`;
          element('div', `${date} · ${label} · ${value}`, timelineList, 'quiet-row');
        }
        if (!timelineList.childElementCount) element('div', S('emptyTimeline'), timelineList, 'empty');
      }
      const ledger = state.analysis?.ledger; const tasks = ledger?.tasks || [];
      const remaining = tasks.filter(task => ['todo', 'in_progress', 'blocked', 'needs_verification'].includes(task.status));
      const completed = tasks.filter(task => task.status === 'done');
      totals.textContent = tasks.length ? S('totalsPattern', { done: completed.length, total: tasks.length }) : S('totalsEmpty');
      tasksHeading.textContent = S('remainingHeadingPattern', { count: remaining.length });
      remainingToggle.hidden = remaining.length <= 3;
      remainingToggle.textContent = target.remainingExpanded ? S('collapseArrow') : S('showAllCountPattern', { count: remaining.length });
      remainingToggle.setAttribute('aria-expanded', String(Boolean(target.remainingExpanded)));
      const tasksKey = JSON.stringify([remaining, state.analysis?.sources, Boolean(target.remainingExpanded), activeLang]);
      if (target.tasksKey !== tasksKey) {
        target.tasksKey = tasksKey; currentTasks.replaceChildren();
        if (!tasks.length) element('div', S('emptyNoTasks'), currentTasks, 'empty');
        else if (!remaining.length) element('div', S('emptyNoRemaining'), currentTasks, 'empty');
        for (const task of target.remainingExpanded ? remaining : remaining.slice(0, 3)) renderTask(task, state.analysis?.sources, currentTasks);
      }
      historyCount.textContent = S('countArrowPattern', { count: completed.length });
      const completedKey = JSON.stringify([completed, state.analysis?.sources, activeLang]);
      if (target.completedKey === completedKey) return;
      target.completedKey = completedKey; historyList.replaceChildren();
      for (const task of completed) renderTask(task, state.analysis?.sources, historyList);
      if (!completed.length) element('div', S('emptyCompleted'), historyList, 'empty');
    };

    const pollHistory = () => {
      if (panel !== target) return;
      target.request('analysis-state', 7000).then(showHistory).catch(() => {
        if (panel !== target) return;
        analysisMessage.textContent = S('retryingStatus');
        clearTimeout(target.pollTimer); target.pollTimer = setTimeout(pollHistory, 2000);
      });
    };
    target.pollHistory = pollHistory;
    const showHistory = state => {
      if (panel !== target || !state || (target.historyRevision ?? -1) > state.revision) return;
      target.historyRevision = state.revision; target.analysisState = state;
      const active = (state.timeline || []).find(item => item.source === 'analysis' && item.status === 'pending');
      target.analyzing = Boolean(active); analyze.disabled = target.analyzing;
      const stages = strings.analysisStages || { starting: '正在启动分析', reading: '正在读取会话', retrying: '正在重新连接', analyzing: '正在分析任务' };
      target.stageMessage = active ? (stages[active.stage] || stages.analyzing) : '';
      const latest = state.timeline?.at(-1);
      analysisMessage.textContent = target.stageMessage || (latest?.status === 'failed' ? `${S('analysisFailedPrefix')}${latest.error || S('analysisFailedRetry')}` : ''); analyze.textContent = active ? S('btnUpdating') : S('btnUpdate');
      clearTimeout(target.pollTimer); if (active && !embedded?.streamConnected) target.pollTimer = setTimeout(pollHistory, 2000);
      refreshPanel();
    };
    target.showHistory = showHistory;
    analyze.onclick = async () => {
      analyze.disabled = true; analysisMessage.textContent = S('startingAnalysisFeedback');
      try { showHistory(await target.request('analyze', 7000)); }
      catch (error) {
        if (panel !== target) return;
        if (['STATUS_REQUEST_TIMEOUT', 'STATUS_SEND_FAILED'].includes(error.code)) {
          analysisMessage.textContent = S('retryingStatus'); clearTimeout(target.pollTimer); target.pollTimer = setTimeout(pollHistory, 2000);
        } else { analysisMessage.textContent = error.message; analyze.disabled = false; }
      }
    };
    const setProgress = value => {
      const state = presentation ? presentation.progressState(target.draft.state, value) : value === 100 ? target.draft.state === 'pushed' ? 'pushed' : 'completed'
        : value === 0 && target.draft.state === 'unstarted' ? 'unstarted' : 'unfinished';
      updateDraft(target, { progress: value, state });
    };
    let dragging = false;
    slider.onpointerdown = () => { dragging = true; range.classList.add('is-dragging'); };
    const endDrag = () => { dragging = false; range.classList.remove('is-dragging'); }; slider.onpointerup = endDrag; slider.onpointercancel = endDrag; slider.onlostpointercapture = endDrag;
    slider.oninput = () => { const value = Number(slider.value), nearest = Math.round(value / 25) * 25; setProgress(presentation ? presentation.progressValue(value, dragging) : dragging && Math.abs(value - nearest) <= 2 ? nearest : value); };
    progress.oninput = () => { const raw = progress.value.trim(); if (!raw) setProgress(null); else if (Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 100) setProgress(Number(raw)); else target.dirty = true; };
    unknown.onclick = () => setProgress(null);
    note.oninput = () => { target.draft.note = note.value; target.dirty = true; rememberPanel(target); };
    submit.onclick = async () => { if (await save({}, false, target)) target.setView('overview'); };
    progress.onkeydown = event => { if (event.key === 'Enter') submit.click(); };
    clear.onclick = async () => { if (await save({}, true, target)) target.setView('overview'); };
    if (close) close.onclick = () => closePanel();
    if (openPane) openPane.onclick = async () => {
      openPane.disabled = true; analysisMessage.textContent = '';
      try { await harness.openPane({ entry, request: target.request }); if (panel === target) closePanel(); }
      catch (error) { if (panel === target) { openPane.disabled = false; analysisMessage.textContent = error.message; } }
    };
    // 完整子树与主题属性就绪后一次性挂载进文档，杜绝首帧按默认暗底渲染后再切浅色的闪烁。
    (embedded?.container || document.body).append(root);
    // 首次历史读取前以当前快照为基线：读取期间到达的新版快照会触发补读。
    target.syncVersion = panelVersion(entry.key);
    if (embedded?.analysisState) showHistory(embedded.analysisState); else pollHistory();
    pollAppUpdate();
    target.request('project-git', 14000).then(info => { if (panel === target) { target.projectGit = info; refreshPanel(); } }).catch(() => {
      if (panel === target) { target.projectGit = { status: 'unknown', hasRemote: false }; refreshPanel(); }
    });
    entry.button?.setAttribute('aria-expanded', 'true'); refreshPanel();
    const remembered = rememberedPanel(entry.key);
    if (remembered) restorePanel(target, remembered); else if (!embedded) editOpen.focus();
  }

  function receive(next) {
    if (!next || (next.revision < snapshot.revision && (!next.lang || next.lang === activeLang))) return;
    const langChanged = next.lang ? setLang(next.lang) : false;
    snapshot = next;
    if (langChanged && panel) panel.applyLocale?.();
    for (const entry of mounted.values()) paint(entry);
    refreshPanel();
    // 其他入口改了这个会话（保存、清除、分析、任务来源）：按单会话数据版本补读；弹窗忙时记下，空闲后补读一次。乱序回复由 historyRevision 丢弃。
    if (panel?.pollHistory) syncPanel(panel);
  }

  function panelVersion(key) {
    if (snapshot.keyVersions) return snapshot.keyVersions[key] ?? snapshot.keyVersionBase ?? 0;
    return JSON.stringify([snapshot.records?.[key] || null, (snapshot.analyzingKeys || []).includes(key)]);
  }

  function syncPanel(target) {
    const version = panelVersion(target.entry.key);
    if (target.syncVersion === undefined) { target.syncVersion = version; return; }
    if (target.syncVersion === version && !target.syncPending) return;
    if (target.busy) { target.syncPending = true; return; }
    target.syncVersion = version; target.syncPending = false; target.pollHistory();
  }

  function onOutside(event) {
    if (!panel || event.composedPath().includes(panel.root) || event.composedPath().includes(panel.entry.host)) return;
    if (event.composedPath().some(node => node.hasAttribute?.('data-codex-session-status'))) return;
    closePanel(false);
  }

  function onKey(event) {
    if (!panel || event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    closePanel();
  }

  function onScroll() {
    if (!panel) return;
    if (!visible(panel.entry.host)) closePanel(false);
    else positionPanel();
  }

  const observer = new MutationObserver(records => {
    if (records.every(r => r.target.closest?.('[data-codex-session-status], [data-codex-session-status-panel]'))) return;
    schedule();
  });
  const rootObserver = !embedded ? new MutationObserver(() => {
    const mode = panel?.root.getAttribute('data-color-mode') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    syncAccent(panel?.root, mode === 'dark');
    for (const entry of mounted.values()) {
      entry.host?.style.setProperty('--accent', currentAccent);
      if (snapshot.analyzingKeys?.includes(entry.key)) makeRing(entry.button, recordFor(entry.key), false, true);
    }
  }) : null;
  const headObserver = !embedded && document.head ? new MutationObserver(() => {
    const mode = panel?.root.getAttribute('data-color-mode') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    syncAccent(panel?.root, mode === 'dark');
    for (const entry of mounted.values()) entry.host?.style.setProperty('--accent', currentAccent);
  }) : null;
  const filter = harness?.attributeFilter || ['data-app-action-sidebar-thread-selected', 'data-app-action-sidebar-thread-id', 'data-app-action-sidebar-thread-host-id', 'data-app-action-sidebar-thread-title', 'hidden', 'aria-expanded', 'style', 'class', 'data-theme', 'data-mode'];
  if (!embedded) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: filter });
    rootObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-mode', 'data-appearance-preset'] });
    headObserver?.observe(document.head, { childList: true, subtree: true, characterData: true });
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
  }
  window.addEventListener('resize', positionPanel);
  syncAccent(null, matchMedia('(prefers-color-scheme: dark)').matches);
  const api = {
    receive(next) { receive(next); localCards?.receive(next); },
    receiveCardEvent({ snapshot: next, analysisState, session }) {
      if (!embedded) return;
      embedded.streamConnected = true;
      if (!next || next.revision < snapshot.revision) return;
      if (panel && session?.key === panel.entry.key) panel.capabilities = session.capabilities;
      receive(next);
      panel?.showHistory(analysisState);
    },
    disconnectCardEvents() {
      if (!embedded?.streamConnected) return;
      embedded.streamConnected = false;
      if (panel?.analyzing) panel.pollHistory();
    },
    setTheme(theme) {
      if (!embedded) return;
      if (['light', 'dark'].includes(theme) && embedded.theme !== theme) {
        embedded.theme = theme;
        positionPanel();
      } else if (panel?.root) {
        if (panel.root.getAttribute('data-color-mode') !== (embedded.theme || theme) && ['light', 'dark'].includes(embedded.theme || theme)) {
          positionPanel();
        } else {
          syncAccent(panel.root, (embedded.theme || 'dark') === 'dark');
        }
      }
    },
    reply(message) {
      localCards?.reply(message);
      const { requestId, error, errorInfo, session, snapshot: next, analysisState, projectGit, updateInfo, navigation, pane } = message;
      if (panel && session?.key === panel.entry.key) panel.capabilities = session.capabilities;
      receive(next);
      const request = pending.get(requestId);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(requestId);
      if (error) request.reject(Object.assign(new Error(error), errorInfo || {})); else request.resolve(navigation || updateInfo || projectGit || analysisState || pane);
    },
    status: () => ({ mounted: mounted.size, panelOpen: Boolean(panel), revision: snapshot.revision, version, startup: { ...startup } }),
    exportForReload({ allowPending = false } = {}) {
      if (!allowPending && (panel?.busy || pending.size)) return { busy: true };
      const active = panel ? rememberPanel(panel) : null;
      return { snapshot, panel: active, panelStates: [...panelStates], localCards: localCards?.exportState() };
    },
    destroy() {
      destroyed = true; localCards?.destroy(); harness?.dispose?.(); observer.disconnect(); rootObserver?.disconnect(); headObserver?.disconnect(); cancelAnimationFrame(frame);
      if (panel) { rememberPanel(panel); panelEvent('dispose', panel.entry); clearTimeout(panel.pollTimer); clearTimeout(panel.updateTimer); clearTimeout(panel.manualCheckTimer); cancelAnimationFrame(panel.marqueeFrame); panel.resizeObserver?.disconnect(); panel.root.remove(); panel.entry.button?.setAttribute('aria-expanded', 'false'); panel = null; }
      for (const entry of [...mounted.values()]) unmount(entry);
      document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', positionPanel);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(S('cardDaemonDisconnected'))); }
      pending.clear(); if (!embedded?.independent) delete window.__codexSessionStatus;
      if (harness?.globalName && window[harness.globalName]) delete window[harness.globalName];
    }
  };
  if (!embedded?.independent) window.__codexSessionStatus = api;
  if (!embedded?.independent && harness?.globalName) window[harness.globalName] = api;
  if (embedded) {
    receive(embedded.snapshot);
    openPanel({ key: embedded.key, title: embedded.title });
    if (restored?.panel) restorePanel(panel, restored.panel);
    return api;
  }
  localCards = harness?.createLocalCards?.({
    mount: (options, state) => installCodexSessionStatus(version, state, options),
    send: payload => send(payload), snapshot: () => snapshot, restored: restored?.localCards,
  });
  reconcile();
  if (restored) {
    receive(restored.snapshot);
    const saved = restored.panel;
    const entry = saved && [...mounted.values()].find(item => item.key === saved.key);
    if (entry) {
      panelStates.set(saved.key, saved);
      openPanel(entry);
    }
  }
}
'use strict';

const React = require('react');
let createPortal = null;
try { createPortal = require('react-dom')?.createPortal || null; } catch { /* test or headless */ }
let uiPrimitives = null;
try { uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch { /* test or headless */ }

const h = React.createElement;
let fallbackIdSeq = 0;
const { useState, useEffect, useRef } = React;
const useMemo = React.useMemo || (fn => fn());
const useLayoutEffect = React.useLayoutEffect || React.useEffect;
const useId = React.useId || (() => `at-dsh-id-${++fallbackIdSeq}`);

const NS = 'agentThings';
const TAB_PROVIDER_ID = 'agent-things-dsh';
const TAB_KIND = 'things';
const HOST_STYLE_ID = 'agent-things-dsh-host-layout';

function getPresentationFactory() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.__agentThingsCreatePresentation === 'function') {
    return globalThis.__agentThingsCreatePresentation;
  }
  return null;
}

function getPresentation(lang) {
  const create = getPresentationFactory();
  if (create) {
    try { return create(lang); } catch { /* ignore */ }
  }
  return (typeof globalThis !== 'undefined' && globalThis.__agentThingsPresentation) || null;
}

function normalizeLang(localeValue) {
  const raw = typeof localeValue === 'string'
    ? localeValue
    : (localeValue?.active || 'zh');
  return /^zh\b/i.test(String(raw)) ? 'zh' : 'en';
}

function isDarkThemeActive() {
  if (typeof document === 'undefined') return false;
  if (document.body?.hasAttribute?.('data-ds-dark-theme')) return true;
  if (document.documentElement?.style?.colorScheme === 'dark') return true;
  if (typeof matchMedia === 'function') {
    return Boolean(matchMedia('(prefers-color-scheme: dark)').matches);
  }
  return false;
}

function resolveOfficialAccent(lang = 'zh') {
  const accent = getPresentation(lang)?.accent;
  return {
    normal: accent?.normal || '#0169CC',
    hover: accent?.hover || '#005bb3',
    pressed: accent?.pressed || '#004f9c',
    onAccent: accent?.onAccent || '#FFFFFF',
  };
}

function readHostTheme(containerEl = null, lang = 'zh') {
  const dark = isDarkThemeActive();
  const mode = dark ? 'dark' : 'light';
  const fallbackBg = dark ? '#0e1318' : '#ffffff';
  const fallbackFg = dark ? '#e6edf3' : '#22272e';
  const fallbackMuted = dark ? '#a0a6ad' : '#576374';
  const accent = resolveOfficialAccent(lang);

  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
    return { mode, bg: fallbackBg, fg: fallbackFg, mutedFg: fallbackMuted, primary: accent.normal, accent };
  }

  let bg = '';
  let node = containerEl;
  while (node && node !== document.documentElement) {
    try {
      const c = getComputedStyle(node).backgroundColor;
      if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') {
        bg = c;
        break;
      }
    } catch { /* ignore */ }
    node = node.parentElement;
  }

  const bodyStyle = document.body ? getComputedStyle(document.body) : null;
  const rootStyle = document.documentElement ? getComputedStyle(document.documentElement) : null;
  const readVar = name => bodyStyle?.getPropertyValue(name)?.trim() || rootStyle?.getPropertyValue(name)?.trim() || '';

  bg ||= readVar('--dsw-alias-bg-layer-1') || readVar('--dsw-alias-bg-base') || bodyStyle?.backgroundColor || fallbackBg;
  const fg = readVar('--dsw-alias-label-primary') || bodyStyle?.color || fallbackFg;
  const mutedFg = readVar('--dsw-alias-label-secondary') || readVar('--dsw-alias-label-tertiary') || fallbackMuted;

  return { mode, bg, fg, mutedFg, primary: accent.normal, accent };
}

function syncDocumentAccent(containerEl = null, lang = 'zh') {
  const theme = readHostTheme(containerEl, lang);
  if (typeof window !== 'undefined') {
    window.__agentThingsHostAccent = theme.primary;
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    try {
      document.documentElement.style?.setProperty?.('--agent-things-accent', theme.primary);
      if (document.documentElement.dataset) {
        document.documentElement.dataset.mode = theme.mode;
      }
    } catch { /* ignore */ }
  }
  return theme;
}

function normalizeSpace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function resolveSessionTitleFromDom(sessionId) {
  if (typeof document === 'undefined' || !sessionId) return '';
  for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
    if (row.getAttribute('data-row-key') === `session:${sessionId}`) {
      const titleEl = row.querySelector('[class*="title"]');
      const txt = titleEl?.textContent?.trim();
      if (txt) return txt;
    }
  }
  return '';
}

function sessionIdFromKey(key) {
  if (typeof key !== 'string') return '';
  try {
    const parsed = JSON.parse(key);
    if (Array.isArray(parsed) && typeof parsed[1] === 'string') {
      return parsed[1].replace(/^local:/, '');
    }
  } catch { /* fallback */ }
  return String(key).replace(/^local:/, '');
}

function keyForSession(sessionId) {
  return JSON.stringify(['local', String(sessionId || '').replace(/^local:/, '')]);
}

function activeMainViewSessionId(ctx) {
  try {
    const byId = ctx.sessions?.list?.getSnapshot?.()?.byId;
    if (byId && typeof byId === 'object') {
      for (const row of Object.values(byId)) {
        if ((row?.retainedBy?.mainView ?? 0) > 0 && row?.id) return row.id;
      }
    }
  } catch { /* ignore */ }
  if (typeof document !== 'undefined') {
    const selected = document.querySelector('[data-row-key^="session:"][aria-selected="true"]');
    const rowKey = selected?.getAttribute?.('data-row-key') || '';
    if (rowKey.startsWith('session:')) return rowKey.slice('session:'.length);
  }
  return '';
}

async function findTurnElement(turn, locator, role) {
  const snippet = locator ? normalizeSpace(locator).slice(0, 48) : '';
  for (let attempt = 0; attempt < 18; attempt++) {
    const turnNodes = turn != null
      ? [...document.querySelectorAll(`[data-chat-turn="${turn}"]:not([hidden])`)]
      : [...document.querySelectorAll('[data-chat-anchor-key]:not([hidden])')];
    if (turnNodes.length) {
      if (snippet) {
        const matched = turnNodes.filter(el => normalizeSpace(el.textContent).includes(snippet));
        if (matched.length) {
          return role === 'assistant' ? matched[matched.length - 1] : matched[0];
        }
      }
      if (turn != null) {
        return role === 'assistant' ? turnNodes[turnNodes.length - 1] : turnNodes[0];
      }
    }
    await new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 40);
    });
  }
  return null;
}

const HOST_LAYOUT_CSS = `
[data-row-key^="session:"] {
  height: 38px !important;
  min-height: 38px !important;
}
[data-row-key^="session:"] > span[class*="title"] {
  line-height: 26px !important;
}
[data-row-key^="session:"] > span:first-child:has([data-at-dsh-leading-slot]) {
  width: 24px !important;
  min-width: 24px !important;
  height: 28px !important;
  flex: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}
[data-at-dsh-leading-slot] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 28px;
}
[data-at-dsh-sidebar-host] {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
}
.at-dsh-sidebar-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  border: 0;
  margin: 0;
  padding: 0;
  background: transparent;
}
.at-dsh-command-host {
  margin-top: 8px;
  max-width: 100%;
}
.at-dsh-flash-highlight {
  animation: at-dsh-flash 1.8s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes at-dsh-flash {
  0% { box-shadow: 0 0 0 2px #4176e6, 0 0 0 6px rgba(65, 118, 230, 0.24); border-radius: 10px; }
  70% { box-shadow: 0 0 0 2px #4176e6, 0 0 0 3px rgba(65, 118, 230, 0.1); border-radius: 10px; }
  100% { box-shadow: none; }
}
.at-dsh-plugin-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 680px;
}
.at-dsh-plugin-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.at-dsh-plugin-head-copy {
  flex: 1 1 auto;
  min-width: 0;
}
.at-dsh-plugin-refresh-btn {
  flex: 0 0 auto;
  white-space: nowrap;
}
@keyframes at-dsh-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: no-preference) {
  .at-dsh-plugin-refresh-btn.is-loading svg {
    animation: at-dsh-spin 0.9s linear infinite;
  }
}
.at-dsh-plugin-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.at-dsh-plugin-desc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.at-dsh-plugin-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.at-dsh-plugin-field-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.at-dsh-plugin-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.at-dsh-plugin-hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.at-dsh-plugin-banner {
  border-radius: var(--dsw-radius-md, 8px);
  padding: 8px 12px;
  font-size: 12px;
  line-height: 18px;
}
.at-dsh-plugin-banner-warn {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-state-warn-label);
  border: 0.5px solid var(--dsw-alias-border-l3);
}
.at-dsh-plugin-banner-error {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}
.at-dsh-model-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color 140ms ease, border-color 140ms ease;
}
@media (hover: hover) {
  .at-dsh-model-trigger:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.at-dsh-model-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, #0169CC);
}
.at-dsh-model-trigger:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}
.at-dsh-model-trigger-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.at-dsh-model-trigger-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-dsh-model-trigger-provider {
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-dsh-model-chevron {
  flex: none;
  color: var(--dsw-alias-label-caption);
}
.at-dsh-model-select-native {
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.at-dsh-model-menu {
  box-sizing: border-box;
  z-index: 1200;
  border: 0;
  padding: 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
}
.at-dsh-model-menu-search {
  flex-shrink: 0;
  position: relative;
  margin: 2px 0 3px;
}
.at-dsh-model-menu-search-clear {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.at-dsh-model-menu-groups {
  min-height: 0;
  overflow: hidden auto;
}
.at-dsh-model-menu-option {
  box-sizing: border-box;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (hover: hover) {
  .at-dsh-model-menu-option:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.at-dsh-model-menu-option:focus-visible {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.at-dsh-model-menu-option-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.at-dsh-model-menu-option-name {
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-dsh-model-menu-option-sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-dsh-model-menu-check {
  flex: 0 0 14px;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-primary);
}
.at-dsh-plugin-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.at-dsh-plugin-status {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
`.trim();

function injectHostLayoutStyles() {
  if (typeof document === 'undefined' || !document.head) return () => {};
  let styleEl = document.head.querySelector(`style[data-plugin="${TAB_PROVIDER_ID}"]`);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-plugin', TAB_PROVIDER_ID);
    styleEl.setAttribute('data-id', HOST_STYLE_ID);
    styleEl.textContent = HOST_LAYOUT_CSS;
    styleEl.__atDshLayoutRefCount = 0;
    document.head.appendChild(styleEl);
  }
  styleEl.__atDshLayoutRefCount = (styleEl.__atDshLayoutRefCount || 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    styleEl.__atDshLayoutRefCount = Math.max(0, (styleEl.__atDshLayoutRefCount || 1) - 1);
    if (styleEl.__atDshLayoutRefCount === 0) {
      try { styleEl.remove(); } catch { /* ignore */ }
    }
  };
}

function createDshBridge(ctx) {
  let summary = { version: 1, revision: 0, lang: normalizeLang(ctx.locale?.getLocale?.()), items: {} };
  let uiSnapshot = { version: 1, revision: 0, lang: summary.lang, records: {}, analyzingKeys: [], keyVersionBase: 0, keyVersions: {} };
  const details = new Map();
  const detailPromises = new Map();
  const listeners = new Set();
  const localeListeners = new Set();
  const sessionWaiters = new Map();
  const flashTimers = typeof WeakMap === 'function' ? new WeakMap() : null;
  let stopped = false;
  let sseController = null;
  let reconnectTimer = null;
  let backoffMs = 1000;
  let mainApi = null;
  const embeddedCards = new Set();

  const activeLang = () => normalizeLang(ctx.locale?.getLocale?.());

  const notifyLocale = () => {
    const nextLang = activeLang();
    for (const listener of [...localeListeners]) {
      try { listener(nextLang); } catch { /* isolate subscriber */ }
    }
  };

  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* isolate subscriber */ }
    }
  };

  const notifySessionSubscribers = sessionId => {
    const subs = sessionWaiters.get(sessionId);
    if (!subs?.size) return;
    const detail = details.get(sessionId);
    const sidebar = detail?.sidebarSession;
    if (!sidebar) return;
    const title = resolveSessionTitleFromDom(sessionId);
    const payload = title ? { ...sidebar, title } : sidebar;
    for (const cb of [...subs]) {
      try { cb(payload); } catch { /* isolate */ }
    }
  };

  const syncEmbeddedCardsForSession = (sessionId, detail) => {
    for (const card of [...embeddedCards]) {
      if (card.sessionId !== sessionId || !card.api) continue;
      try {
        if (detail) {
          card.api.receiveCardEvent({
            snapshot: uiSnapshot,
            analysisState: detail.analysisState || null,
            session: detail.session || null,
          });
        } else {
          card.api.receive(uiSnapshot);
        }
      } catch { /* ignore disposed card */ }
    }
  };

  const applyUiSnapshot = next => {
    if (!next || typeof next !== 'object') return;
    if (typeof next.revision === 'number' && next.revision < uiSnapshot.revision && (!next.lang || next.lang === uiSnapshot.lang)) {
      return;
    }
    uiSnapshot = next;
    try {
      mainApi?.receive(uiSnapshot);
    } catch { /* ignore */ }
    for (const card of [...embeddedCards]) {
      if (!details.has(card.sessionId)) {
        try { card.api?.receive(uiSnapshot); } catch { /* ignore */ }
      }
    }
  };

  const apiFetch = async (urlPath, options = {}) => {
    const lang = activeLang();
    const sep = urlPath.includes('?') ? '&' : '?';
    const url = `${urlPath}${sep}lang=${encodeURIComponent(lang)}`;
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data?.errorInfo?.code;
      throw err;
    }
    return data;
  };

  const applyDetailPayload = (sessionId, data) => {
    if (!sessionId || !data) return;
    if (details.size >= 100 && !details.has(sessionId)) {
      details.delete(details.keys().next().value);
    }
    details.set(sessionId, data);
    if (data.snapshot) applyUiSnapshot(data.snapshot);
    const rev = data.revision ?? summary.revision;
    if (data.record?.state || data.analyzing || data.timeline?.latestStatus === 'failed') {
      summary = {
        ...summary,
        revision: Math.max(summary.revision || 0, rev || 0),
        items: {
          ...summary.items,
          [sessionId]: {
            ...(summary.items?.[sessionId] || {}),
            sessionId,
            revision: data.revision,
            state: data.record?.state ?? null,
            progress: data.record?.progress ?? null,
            note: data.record?.note ? String(data.record.note).slice(0, 240) : '',
            analyzing: Boolean(data.analyzing),
            analysisStatus: data.analyzing ? 'pending' : (data.timeline?.latestStatus || null),
            analysisStage: data.timeline?.stage || null,
            analysisError: data.timeline?.latestError || null,
            tasksSummary: data.analysis?.ledger ? {
              total: data.analysis.ledger.totalTasks ?? data.analysis.ledger.tasks?.length ?? 0,
              done: data.analysis.ledger.completedTasks ?? (data.analysis.ledger.tasks?.filter(t => t.status === 'done').length || 0),
              percent: data.analysis.ledger.percent ?? 0,
            } : null,
          },
        },
      };
    } else if (summary.items?.[sessionId]) {
      const nextItems = { ...summary.items };
      delete nextItems[sessionId];
      summary = { ...summary, revision: Math.max(summary.revision || 0, rev || 0), items: nextItems };
    }
    syncEmbeddedCardsForSession(sessionId, data);
    notifySessionSubscribers(sessionId);
    notify();
  };

  const fetchSessionDetail = async (sessionId, { force = false, includeGit = true } = {}) => {
    if (!sessionId || stopped) return null;
    const reqKey = `${sessionId}:${activeLang()}:${includeGit ? '1' : '0'}`;
    if (!force && detailPromises.has(reqKey)) return detailPromises.get(reqKey);
    const task = (async () => {
      try {
        const data = await apiFetch(`api/agent-things/session?sessionId=${encodeURIComponent(sessionId)}&includeGit=${includeGit ? '1' : '0'}`);
        applyDetailPayload(sessionId, data);
        return data;
      } finally {
        detailPromises.delete(reqKey);
      }
    })();
    detailPromises.set(reqKey, task);
    return task;
  };

  const refreshSummary = async () => {
    if (stopped) return summary;
    try {
      const next = await apiFetch('api/agent-things/summary');
      summary = { ...next, items: next?.items || {} };
      if (next?.snapshot) applyUiSnapshot(next.snapshot);
      notify();
    } catch { /* retry via SSE or interaction */ }
    return summary;
  };

  const rpc = async payloadObj => {
    const body = { ...payloadObj, lang: activeLang() };
    return apiFetch('api/agent-things/rpc', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  const getAnalysisConfig = async () => apiFetch('api/agent-things/analysis-config');

  const saveAnalysisConfig = async nextConfig => apiFetch('api/agent-things/analysis-config', {
    method: 'POST',
    body: JSON.stringify({ ...nextConfig, lang: activeLang() }),
  });

  const locateAndJump = async (sessionId, { taskId, itemId, turnId, locator } = {}) => {
    const res = await apiFetch('api/agent-things/locate', {
      method: 'POST',
      body: JSON.stringify({ sessionId, taskId, itemId, turnId, locator, lang: activeLang() }),
    });
    if (!res?.located) return res;

    try {
      ctx.uiWorkspace?.openSession?.(sessionId);
    } catch { /* already open */ }

    if (typeof document !== 'undefined') {
      const targetKey = `session:${sessionId}`;
      const waitFrame = () => new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 25);
      });
      for (let w = 0; w < 12; w++) {
        const rows = [...document.querySelectorAll('[data-row-key^="session:"]')];
        const row = rows.find(el => el.getAttribute('data-row-key') === targetKey);
        if (!row || row.getAttribute('aria-selected') === 'true') break;
        await waitFrame();
      }
    }

    if (res.seq != null && ctx.sessions?.using) {
      try {
        await ctx.sessions.using(sessionId, { source: 'controllerOperation' }, async ref => {
          const binding = await ref.ready;
          if (typeof binding?.session?.loadThrough === 'function') {
            await binding.session.loadThrough(res.seq);
          }
        });
      } catch { /* proceed with current DOM */ }
    }

    const hitElement = await findTurnElement(res.turn, res.locator, res.role);
    if (!hitElement) {
      const ui = getPresentation(activeLang());
      return { located: false, reason: 'dom_not_found', message: ui?.strings?.locateNotFound || res.message };
    }
    hitElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hitElement.classList.remove('at-dsh-flash-highlight');
    void hitElement.offsetWidth;
    hitElement.classList.add('at-dsh-flash-highlight');
    if (flashTimers?.has(hitElement)) {
      clearTimeout(flashTimers.get(hitElement));
    }
    const timerId = setTimeout(() => {
      if (flashTimers?.get(hitElement) === timerId) {
        flashTimers.delete(hitElement);
      }
      hitElement.classList.remove('at-dsh-flash-highlight');
    }, 2000);
    flashTimers?.set(hitElement, timerId);
    return { ...res, scrolled: true };
  };

  const handleSseEvent = (eventType, rawData) => {
    let payload;
    try { payload = JSON.parse(rawData); } catch { return; }
    if (eventType === 'snapshot') {
      summary = { ...payload, items: payload?.items || {} };
      if (payload?.snapshot) applyUiSnapshot(payload.snapshot);
      notify();
      const idsToRefresh = new Set([
        ...details.keys(),
        ...sessionWaiters.keys(),
        ...[...embeddedCards].map(c => c.sessionId),
      ]);
      for (const sid of idsToRefresh) {
        if (sid) void fetchSessionDetail(sid, { force: true, includeGit: false }).catch(() => {});
      }
      return;
    }
    if (eventType === 'update') {
      const nextItems = { ...(summary.items || {}) };
      for (const [sid, val] of Object.entries(payload?.items || {})) {
        if (val === null) delete nextItems[sid];
        else nextItems[sid] = val;
      }
      summary = { ...summary, revision: payload?.revision ?? summary.revision, items: nextItems };
      if (payload?.snapshot) applyUiSnapshot(payload.snapshot);
      notify();
      for (const sid of payload?.changedSessionIds || []) {
        if (details.has(sid) || sessionWaiters.has(sid) || [...embeddedCards].some(c => c.sessionId === sid)) {
          void fetchSessionDetail(sid, { force: true, includeGit: false }).catch(() => {});
        }
      }
    }
  };

  const connectSse = async () => {
    if (stopped) return;
    if (sseController) {
      sseController.abort();
      sseController = null;
    }
    clearTimeout(reconnectTimer);
    const controller = new AbortController();
    sseController = controller;
    try {
      const res = await fetch(`api/agent-things/events?lang=${encodeURIComponent(activeLang())}`, {
        credentials: 'same-origin',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
      backoffMs = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!stopped && !controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!frame.trim() || frame.startsWith(':')) continue;
          let eventType = 'message';
          const dataLines = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
          }
          if (dataLines.length) handleSseEvent(eventType, dataLines.join('\n'));
        }
      }
    } catch { /* reconnect with backoff */ }
    if (!stopped && sseController === controller) {
      reconnectTimer = setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, 10000);
        void connectSse();
      }, backoffMs);
    }
  };

  const openSidebarForSession = sessionId => {
    if (sessionId) {
      try { ctx.uiWorkspace?.openSession?.(sessionId); } catch { /* ignore */ }
    }
    try { ctx.sidebarRight?.openTab?.(TAB_KIND); } catch { /* ignore */ }
  };

  const subscribeSession = (sessionId, listener) => {
    if (!sessionId) return () => {};
    let set = sessionWaiters.get(sessionId);
    if (!set) {
      set = new Set();
      sessionWaiters.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) sessionWaiters.delete(sessionId);
    };
  };

  const setMainApi = api => { mainApi = api; };
  const registerEmbeddedCard = card => {
    embeddedCards.add(card);
    return () => { embeddedCards.delete(card); };
  };

  const syncAfterRpcResponse = (message, res) => {
    if (res?.snapshot) applyUiSnapshot(res.snapshot);
    const sid = sessionIdFromKey(message?.key);
    if (sid && ['update', 'clear', 'analyze'].includes(message?.type)) {
      void fetchSessionDetail(sid, { force: true, includeGit: false }).catch(() => {});
    }
  };

  const handlePanelPayload = async (rawPayload, targetApi) => {
    let message;
    try { message = JSON.parse(rawPayload); } catch { return; }
    if (message?.type === 'open-pane') {
      const sid = sessionIdFromKey(message.key);
      openSidebarForSession(sid);
      targetApi?.reply({ requestId: message.requestId, pane: { delivered: true } });
      return;
    }
    if (message?.type === 'locate-source') {
      const sid = sessionIdFromKey(message.key);
      try {
        const res = await locateAndJump(sid, message.source || {});
        if (res?.located) {
          targetApi?.reply({ requestId: message.requestId, navigation: res });
        } else {
          const ui = getPresentation(activeLang());
          targetApi?.reply({
            requestId: message.requestId,
            error: res?.message || ui?.strings?.locateNotFound || 'Source message not found',
          });
        }
      } catch (err) {
        targetApi?.reply({ requestId: message.requestId, error: err?.message || 'Locate failed' });
      }
      return;
    }
    try {
      const res = await rpc(message);
      syncAfterRpcResponse(message, res);
      targetApi?.reply(res);
    } catch (err) {
      targetApi?.reply({
        requestId: message?.requestId,
        error: err?.message || 'Request failed',
        errorInfo: { code: err?.code || 'HOST_UNAVAILABLE' },
      });
    }
  };

  const start = () => {
    void refreshSummary();
    void connectSse();
  };

  const dispose = () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    if (sseController) {
      sseController.abort();
      sseController = null;
    }
    listeners.clear();
    localeListeners.clear();
    sessionWaiters.clear();
    details.clear();
    embeddedCards.clear();
    try { mainApi?.destroy?.(); } catch { /* ignore */ }
    mainApi = null;
  };

  return {
    getSummary: () => summary,
    getSummaryItem: sessionId => summary.items?.[sessionId] || null,
    getDetail: sessionId => details.get(sessionId) || null,
    getUiSnapshot: () => uiSnapshot,
    getLang: activeLang,
    subscribe: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    subscribeLocale: fn => {
      localeListeners.add(fn);
      return () => localeListeners.delete(fn);
    },
    notifyLocale,
    subscribeSession,
    setMainApi,
    registerEmbeddedCard,
    refreshSummary,
    fetchSessionDetail,
    applyUiSnapshot,
    rpc,
    getAnalysisConfig,
    saveAnalysisConfig,
    locateAndJump,
    openSidebarForSession,
    handlePanelPayload,
    reconnect: () => {
      void refreshSummary();
      void connectSse();
    },
    start,
    dispose,
  };
}

function buildSidebarIframeBridgeScript(bridgeId, initialSessionId, lang, theme) {
  const presentation = getPresentation(lang);
  const uiBootstrap = {
    lang,
    labels: presentation?.labels || {},
    taskLabels: presentation?.taskLabels || {},
    colors: presentation?.colors || { unstarted: '#9098a2', unfinished: '#c89b38', completed: '#548eea', pushed: '#a17be3' },
    strings: presentation?.strings || {},
    locales: presentation?.locales || {},
  };
  const updateBannerFn = presentation?.updateBannerState
    ? presentation.updateBannerState.toString()
    : 'function(){return{visible:false,active:false,completed:false,failed:false,buttonDisabled:true,label:"",buttonText:"",detail:"",versionText:"",showVersionBar:false,checkDisabled:true,checkFailed:false,checkButtonText:""}}';

  return `<script>
(function(){
  var BRIDGE_ID = ${JSON.stringify(bridgeId)};
  window.__agentThingsLang = ${JSON.stringify(lang)};
  window.__agentThingsHostTheme = ${JSON.stringify({ mode: theme.mode, primary: theme.primary })};
  window.__agentThingsUpdateBannerState = ${updateBannerFn};
  window.__agentThingsI18n = ${JSON.stringify(uiBootstrap)};
  window.sidecar = { conversationId: ${JSON.stringify(initialSessionId || '')} };

  function getHostBridge() {
    var reg = window.parent && window.parent.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__;
    return reg && reg[BRIDGE_ID] ? reg[BRIDGE_ID] : null;
  }

  function applyDshTokens(t) {
    if (!t) return;
    var root = document.documentElement;
    var accent = t.accent || null;
    var normalAccent = (accent && accent.normal) || t.primary;
    if (t.bg) root.style.setProperty('--background', t.bg);
    if (t.fg) root.style.setProperty('--foreground', t.fg);
    if (t.mutedFg) root.style.setProperty('--muted-foreground', t.mutedFg);
    if (normalAccent) root.style.setProperty('--primary', normalAccent);
    if (accent && accent.onAccent) root.style.setProperty('--primary-foreground', accent.onAccent);
    if (t.mode) {
      window.__agentThingsHostTheme = { mode: t.mode, primary: normalAccent || '' };
      root.setAttribute('data-color-mode', t.mode);
      root.style.setProperty('color-scheme', t.mode);
    }
    if (typeof window.syncThemeWithHost === 'function') {
      try { window.syncThemeWithHost(); } catch (e) {}
    }
    if (t.bg) {
      root.style.setProperty('--at-panel-bg', t.bg);
    }
    if (normalAccent) {
      root.style.setProperty('--primary', normalAccent);
      root.style.setProperty('--accent', normalAccent);
    }
    if (accent && accent.hover) root.style.setProperty('--accent-hover', accent.hover);
    if (accent && accent.pressed) root.style.setProperty('--accent-pressed', accent.pressed);
    if (accent && accent.onAccent) {
      root.style.setProperty('--on-accent', accent.onAccent);
      root.style.setProperty('--primary-foreground', accent.onAccent);
    }
  }

  applyDshTokens(${JSON.stringify(theme)});

  var origFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  window.fetch = async function(input, init) {
    var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    var bridge = getHostBridge();
    if (bridge && rawUrl.startsWith('/api/')) {
      var resObj;
      if (rawUrl.startsWith('/api/session')) {
        var qs = rawUrl.split('?')[1] || '';
        var params = new URLSearchParams(qs);
        resObj = await bridge.getSession(params.get('conversationId') || '');
      } else if (rawUrl === '/api/action') {
        var body = init && init.body ? JSON.parse(init.body) : {};
        resObj = await bridge.performAction(body.conversationId, body.action, body.payload || {});
      } else if (rawUrl === '/api/locate') {
        var locBody = init && init.body ? JSON.parse(init.body) : {};
        resObj = await bridge.locate(locBody.conversationId, locBody.source || {});
      } else if (rawUrl.startsWith('/api/ticket')) {
        var tqs = rawUrl.split('?')[1] || '';
        var tparams = new URLSearchParams(tqs);
        resObj = { ok: true, ticket: 'dsh-local', origin: window.location.origin, conversationId: tparams.get('conversationId') || '' };
      } else {
        resObj = { status: 404, body: { error: 'Not found' } };
      }
      var status = (resObj && resObj.status) || 200;
      var payload = (resObj && resObj.body !== undefined) ? resObj.body : resObj;
      return new Response(JSON.stringify(payload), {
        status: status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
    if (origFetch) return origFetch(input, init);
    throw new Error('fetch unavailable');
  };

  function DshEventSource(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = { snapshot: [], change: [], message: [], error: [] };
    var self = this;
    var bridge = getHostBridge();
    var match = String(url).match(/[?&]id=([^&]+)/);
    var convId = match ? decodeURIComponent(match[1]) : (window.sidecar && window.sidecar.conversationId) || '';
    this._unsub = bridge ? bridge.subscribeEvents(convId, function(type, data) {
      if (self.readyState === 2) return;
      var list = self.listeners[type] || [];
      var ev = { type: type, data: JSON.stringify(data) };
      for (var i = 0; i < list.length; i++) {
        try { list[i](ev); } catch (e) {}
      }
    }) : null;
    setTimeout(function() {
      if (self.readyState === 0) self.readyState = 1;
    }, 0);
  }
  DshEventSource.prototype.addEventListener = function(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  };
  DshEventSource.prototype.close = function() {
    this.readyState = 2;
    if (this._unsub) {
      try { this._unsub(); } catch (e) {}
      this._unsub = null;
    }
  };
  window.EventSource = DshEventSource;

  window.addEventListener('message', function(ev) {
    if (!ev || !ev.data) return;
    if (window.parent && window.parent !== window && ev.source != null && ev.source !== window.parent) return;
    if (ev.data.type === 'dsh-theme-sync') {
      applyDshTokens(ev.data.theme);
    } else if (ev.data.type === 'conversation-change' && (ev.data.conversationId || ev.data.allowEmpty)) {
      window.sidecar = { conversationId: ev.data.conversationId || '' };
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyDshTokens(${JSON.stringify(theme)});
    }, { once: true });
  }
})();
</script>`;
}

function composeSidebarHtml({ rawHtml, bridgeId, sessionId, lang, theme }) {
  if (typeof rawHtml !== 'string' || !rawHtml) return '';
  let html = rawHtml.replace(
    '<html lang="zh-CN">',
    `<html lang="${lang === 'en' ? 'en' : 'zh-CN'}" data-color-mode="${theme.mode}" style="color-scheme:${theme.mode}">`,
  );
  const bootstrap = buildSidebarIframeBridgeScript(bridgeId, sessionId, lang, theme);
  if (html.includes('<script src="/preload.js"></script>')) {
    html = html.replace('<script src="/preload.js"></script>', bootstrap);
  } else {
    html = html.replace('</head>', `${bootstrap}\n</head>`);
  }
  return html;
}

function makeUiComponents(ctx, bridge) {
  function LeadingRingAnchor({ sessionId }) {
    const slotRef = useRef(null);
    useEffect(() => {
      if (typeof window !== 'undefined' && typeof window.__agentThingsScheduleReconcile === 'function') {
        window.__agentThingsScheduleReconcile();
      }
      return () => {
        if (typeof window !== 'undefined' && typeof window.__agentThingsScheduleReconcile === 'function') {
          window.__agentThingsScheduleReconcile();
        }
      };
    }, [sessionId]);

    const stopBubble = e => {
      e.stopPropagation();
    };

    return h('span', {
      ref: slotRef,
      'data-at-dsh-leading-slot': sessionId,
      onClick: stopBubble,
      onMouseDown: stopBubble,
      onPointerDown: stopBubble,
      onDoubleClick: stopBubble,
    });
  }

  function ThingsTabTitle() {
    return h('span', null, 'Things');
  }

  function ThingsSidebarTab(props) {
    const hostRef = useRef(null);
    const iframeRef = useRef(null);
    const [activeSessionId, setActiveSessionId] = useState(() => (
      props?.injectedSessionId || props?.sessionId || activeMainViewSessionId(ctx)
    ));
    const currentSessionRef = useRef(activeSessionId);
    currentSessionRef.current = activeSessionId;

    useEffect(() => {
      const propId = props?.injectedSessionId || props?.sessionId;
      if (propId && propId !== currentSessionRef.current) {
        setActiveSessionId(propId);
      }
      const syncActive = () => {
        if (props?.injectedSessionId || props?.sessionId) return;
        const resolved = activeMainViewSessionId(ctx);
        if (resolved && resolved !== currentSessionRef.current) {
          setActiveSessionId(resolved);
        }
      };
      const unsub = typeof ctx.sessions?.list?.subscribe === 'function'
        ? ctx.sessions.list.subscribe(syncActive)
        : () => {};
      return () => {
        try { unsub(); } catch { /* ignore */ }
      };
    }, [props?.injectedSessionId, props?.sessionId]);

    useEffect(() => {
      const iframe = iframeRef.current;
      const host = hostRef.current;
      if (!iframe || !host) return;

      const bridgeId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? `dsh-sb-${crypto.randomUUID()}`
        : `dsh-sidebar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      if (typeof window !== 'undefined') {
        if (!Object.prototype.hasOwnProperty.call(window, '__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__') || !window.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__) {
          Object.defineProperty(window, '__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__', {
            value: Object.create(null),
            writable: true,
            configurable: true,
            enumerable: false,
          });
        }
        window.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__[bridgeId] = {
          getSession: async convId => {
            const sid = String(convId || '').trim();
            if (!sid) return { ok: true, lang: bridge.getLang(), session: null, title: '' };
            try {
              const detail = await bridge.fetchSessionDetail(sid, { force: true });
              const title = resolveSessionTitleFromDom(sid);
              const session = detail?.sidebarSession ? (title ? { ...detail.sidebarSession, title } : detail.sidebarSession) : null;
              return { ok: true, lang: detail?.lang || bridge.getLang(), session, title };
            } catch (err) {
              return { status: 500, body: { error: err?.message || 'Failed to load session' } };
            }
          },
          performAction: async (convId, action, payload = {}) => {
            const sid = String(convId || '').trim();
            const isUpdate = action === 'app-update-info' || action === 'app-update-start';
            if (!isUpdate && !sid) {
              const en = bridge.getLang() === 'en';
              return { status: 400, body: { error: en ? 'Select or open a session first' : '请先打开或选择一个会话' } };
            }
            try {
              const res = await bridge.rpc({
                requestId: `sb-${Date.now().toString(36)}`,
                type: action === 'save' ? 'update' : action,
                ...(sid ? { key: keyForSession(sid) } : {}),
                ...payload,
              });
              if (res?.error) {
                const suffix = res.errorInfo?.code === 'REVISION_CONFLICT' ? ' (conflict)' : '';
                return { status: res.errorInfo?.code === 'REVISION_CONFLICT' ? 409 : 400, body: { error: `${res.error}${suffix}` } };
              }
              if (res?.snapshot) bridge.applyUiSnapshot(res.snapshot);
              if (sid && ['update', 'save', 'clear', 'analyze'].includes(action)) {
                void bridge.fetchSessionDetail(sid, { force: true, includeGit: false }).catch(() => {});
              }
              if (action === 'update' || action === 'save' || action === 'clear') {
                return { ok: true, session: res.session || res.sidebarSession };
              }
              return res;
            } catch (err) {
              return { status: 500, body: { error: err?.message || 'RPC request failed' } };
            }
          },
          locate: async (convId, source) => {
            const sid = String(convId || '').trim();
            if (!sid) return { located: false };
            try {
              return await bridge.locateAndJump(sid, source || {});
            } catch (err) {
              return { located: false, message: err?.message || 'Locate failed' };
            }
          },
          subscribeEvents: (convId, emit) => {
            const sid = String(convId || '').trim();
            if (!sid) return () => {};
            const unsub = bridge.subscribeSession(sid, sessionData => {
              emit('change', sessionData);
            });
            const existing = bridge.getDetail(sid)?.sidebarSession;
            if (existing) {
              setTimeout(() => {
                const title = resolveSessionTitleFromDom(sid);
                emit('snapshot', title ? { ...existing, title } : existing);
              }, 0);
            }
            return unsub;
          },
        };
      }

      const rawHtml = typeof __AGENT_THINGS_SIDEBAR_HTML__ === 'string' ? __AGENT_THINGS_SIDEBAR_HTML__ : '';
      const lang = bridge.getLang();
      const theme = syncDocumentAccent(host, lang);
      iframe.srcdoc = composeSidebarHtml({ rawHtml, bridgeId, sessionId: currentSessionRef.current, lang, theme });

      let lastThemeSig = `${theme.mode}|${theme.primary}|${theme.bg}`;
      const syncFrameTheme = () => {
        const currentLang = bridge.getLang();
        const nextTheme = syncDocumentAccent(host, currentLang);
        lastThemeSig = `${nextTheme.mode}|${nextTheme.primary}|${nextTheme.bg}`;
        try {
          iframe.contentWindow?.postMessage({ type: 'dsh-theme-sync', theme: nextTheme }, '*');
          iframe.contentWindow?.postMessage({ type: 'dsh-lang-sync', lang: currentLang }, '*');
        } catch { /* ignore */ }
      };

      const themeObserver = typeof MutationObserver === 'function' && document.body
        ? new MutationObserver(() => {
            const candidate = readHostTheme(host, bridge.getLang());
            const nextSig = `${candidate.mode}|${candidate.primary}|${candidate.bg}`;
            if (nextSig !== lastThemeSig) syncFrameTheme();
          })
        : null;
      themeObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] });
      iframe.addEventListener('load', syncFrameTheme);
      const unsubLocale = bridge.subscribeLocale?.(nextLang => {
        try {
          iframe.contentWindow?.postMessage({ type: 'dsh-lang-sync', lang: nextLang }, '*');
        } catch { /* ignore */ }
      });

      return () => {
        iframe.removeEventListener('load', syncFrameTheme);
        unsubLocale?.();
        themeObserver?.disconnect();
        if (typeof window !== 'undefined' && window.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__) {
          delete window.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__[bridgeId];
        }
      };
    }, []);

    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const nextSessionId = activeSessionId ? String(activeSessionId).trim() : '';
      const title = nextSessionId ? resolveSessionTitleFromDom(nextSessionId) : '';
      try {
        if (iframe.contentWindow?.sidecar) {
          iframe.contentWindow.sidecar.conversationId = nextSessionId;
        }
        iframe.contentWindow?.postMessage({
          type: 'conversation-change',
          conversationId: nextSessionId,
          title,
          ...(!nextSessionId ? { allowEmpty: true } : {}),
        }, '*');
      } catch { /* iframe may still be booting; window.sidecar holds initialSessionId */ }
    }, [activeSessionId]);

    return h('div', { ref: hostRef, 'data-at-dsh-sidebar-host': '' },
      h('iframe', {
        ref: iframeRef,
        className: 'at-dsh-sidebar-frame',
        title: 'Agent Things',
      }),
    );
  }

  const INLINE_OPEN_PANE_CSS = `
.shell > .open-pane {
  position: absolute;
  right: 13px;
  top: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--secondary);
  cursor: pointer;
  transition: color 150ms var(--ease-out), background-color 150ms var(--ease-out), opacity 160ms var(--ease-out), transform 160ms var(--ease-out);
  z-index: 5;
}
.shell > .open-pane:hover,
.shell > .open-pane:focus-visible {
  color: var(--ink);
  background: var(--hover);
}
.shell > .open-pane:active:not(:disabled) {
  transform: scale(0.94);
}
.shell > .open-pane .open-pane-tip {
  position: absolute;
  right: calc(100% + 6px);
  top: 50%;
  transform-origin: center right;
  transform: translateY(-50%) scale(0.96);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--panel-bg);
  color: var(--ink);
  border: 1px solid var(--line);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out), visibility 0s linear 150ms;
  z-index: 20;
}
.shell > .open-pane:is(:hover, :focus-visible) .open-pane-tip {
  opacity: 1;
  transform: translateY(-50%) scale(1);
  visibility: visible;
  transition: opacity 150ms var(--ease-out) 160ms, transform 150ms var(--ease-out) 160ms, visibility 0s linear 160ms;
}
.shell.has-open-pane .title-heading {
  margin-right: 34px;
}
`;

  function createInlineOpenPaneButton(label) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'open-pane';
    btn.setAttribute('aria-label', label);

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 28 28');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');

    const rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('x', '6.65');
    rect.setAttribute('y', '8.15');
    rect.setAttribute('width', '14.7');
    rect.setAttribute('height', '11.7');
    rect.setAttribute('rx', '3');
    rect.setAttribute('stroke', 'currentColor');
    rect.setAttribute('stroke-width', '1.3');

    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', 'M16.3 8.2V19.8');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.3');

    svg.append(rect, path);

    const tip = document.createElement('span');
    tip.className = 'open-pane-tip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = label;

    btn.append(svg, tip);
    return { btn, tip };
  }

  function attachInlineOpenPaneButton(container, sessionId) {
    let btn = null;
    let tip = null;
    let disposed = false;

    const resolveLabel = () => {
      const lang = bridge.getLang();
      return getPresentation(lang)?.strings?.openInSidebar || (lang === 'en' ? 'Open in sidebar' : '在侧栏打开');
    };

    const ensureMounted = () => {
      if (disposed) return;
      const shadow = container?.firstElementChild?.shadowRoot;
      if (!shadow) return;

      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        if (!shadow.querySelector?.('style[data-at-dsh-open-pane="1"]')) {
          const styleEl = document.createElement('style');
          styleEl.setAttribute('data-at-dsh-open-pane', '1');
          styleEl.textContent = INLINE_OPEN_PANE_CSS;
          shadow.appendChild?.(styleEl);
        }
      }

      const shell = shadow.querySelector?.('.shell');
      if (!shell) return;
      shell.classList?.add?.('has-open-pane');

      const label = resolveLabel();
      const existing = shell.querySelector?.('.open-pane');
      if (existing) {
        btn = existing;
        tip = existing.querySelector?.('.open-pane-tip') || tip;
      } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const created = createInlineOpenPaneButton(label);
        btn = created.btn;
        tip = created.tip;
        btn.addEventListener('click', event => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          bridge.openSidebarForSession(sessionId);
        });
        if (typeof shell.prepend === 'function') shell.prepend(btn);
        else shell.appendChild?.(btn);
      }

      if (btn && btn.getAttribute?.('aria-label') !== label) {
        btn.setAttribute?.('aria-label', label);
      }
      if (tip && tip.textContent !== label) {
        tip.textContent = label;
      }
    };

    ensureMounted();

    const shadow = container?.firstElementChild?.shadowRoot;
    let shadowObserver = null;
    if (typeof MutationObserver === 'function' && shadow) {
      shadowObserver = new MutationObserver(() => ensureMounted());
      try {
        shadowObserver.observe(shadow, { childList: true, subtree: true });
      } catch {
        shadowObserver = null;
      }
    }
    const unsubscribe = bridge.subscribe(() => ensureMounted());

    return () => {
      disposed = true;
      shadowObserver?.disconnect();
      unsubscribe?.();
    };
  }

  function ThingsCommandCard({ sessionId }) {
    const containerRef = useRef(null);
    const cardApiRef = useRef(null);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !sessionId || typeof installCodexSessionStatus !== 'function') return () => {};
      let disposed = false;
      const key = keyForSession(sessionId);
      const existingDetail = bridge.getDetail(sessionId);
      const version = typeof __AGENT_THINGS_VERSION__ === 'string' ? __AGENT_THINGS_VERSION__ : '';
      const cardEntry = { sessionId, api: null };

      const initialTheme = syncDocumentAccent(container, bridge.getLang());

      const api = installCodexSessionStatus(version, null, {
        container,
        key,
        title: resolveSessionTitleFromDom(sessionId) || (bridge.getLang() === 'en' ? 'Current session' : '当前会话'),
        snapshot: bridge.getUiSnapshot(),
        analysisState: existingDetail?.analysisState || null,
        session: existingDetail?.session || null,
        theme: initialTheme.mode,
        lang: bridge.getLang(),
        independent: true,
        streamConnected: true,
        send: rawPayload => {
          Promise.resolve().then(() => {
            if (!disposed && cardEntry.api) {
              void bridge.handlePanelPayload(rawPayload, cardEntry.api);
            }
          });
        },
      });
      cardApiRef.current = api;
      cardEntry.api = api;
      const detachOpenPane = attachInlineOpenPaneButton(container, sessionId);
      const unregister = bridge.registerEmbeddedCard(cardEntry);

      void bridge.fetchSessionDetail(sessionId, { force: true }).catch(() => {});

      const themeObserver = typeof MutationObserver === 'function' && document.body
        ? new MutationObserver(() => {
            if (disposed) return;
            const nextTheme = syncDocumentAccent(container, bridge.getLang());
            api?.setTheme?.(nextTheme.mode);
          })
        : null;
      themeObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] });

      return () => {
        disposed = true;
        themeObserver?.disconnect();
        detachOpenPane();
        unregister();
        try { api?.destroy?.(); } catch { /* ignore */ }
        cardApiRef.current = null;
      };
    }, [sessionId]);

    return h('div', { ref: containerRef, className: 'at-dsh-command-host' });
  }

  const ANALYSIS_COPY = {
    zh: {
      title: '任务解析模型',
      subtitle: '选择用于自动分析 /things 待办清单与进度状态的模型和思考程度，不影响当前对话所使用的模型。',
      refresh: '刷新模型',
      refreshShort: '刷新',
      refreshing: '刷新中…',
      loading: '正在读取当前可用模型目录…',
      modelLabel: '解析模型',
      effortLabel: '思考程度',
      recommendedGroup: '推荐默认',
      defaultTitle: '自动选择 · DeepSeek-V4.1-Flash',
      defaultFallbackTitle: '自动选择 · 可用轻量模型',
      defaultCurrentTag: '默认',
      customTag: '自定义',
      unavailableTag: '当前不可用',
      defaultSelectedHint: '未指定固定模型时默认优先使用 DeepSeek-V4.1-Flash（思考程度默认为 Low）。',
      customSelectedHint: '已固定使用该模型路由：',
      unavailableBanner: '原选模型（{saved}）当前不可用（可能已移除或缺少凭据）；后台分析将临时自动回退到 {fallback}。',
      unavailableNoFallback: '原选模型（{saved}）当前不可用，且未检测到其他可用模型，请先在设置 → 模型中配置服务商或 API Key。',
      providerLoadError: '部分模型提供方加载失败（{name}：{message}）',
      searchPlaceholder: '搜索模型名称或 ID…',
      searchClear: '清空搜索',
      emptyModels: '暂无可用模型，请先在「设置 → 模型」添加或登录账号。',
      noSearchResults: '未找到匹配的模型。',
      effortDefaultLowHint: '默认使用 Low，兼顾 JSON 结构化提取准确率与响应速度。',
      effortUnsupported: '当前所选模型未提供思考程度选项，将直接使用模型默认行为。',
      save: '保存',
      saving: '保存中…',
      discard: '取消更改',
      resetDefault: '恢复默认',
      savedOk: '已保存，将在下次分析时生效。',
      resetOk: '已恢复默认配置（DeepSeek-V4.1-Flash · Low）。',
      loadFailed: '读取模型配置失败：',
      saveFailed: '保存失败：',
      summary: '配置用于 /things 后台任务分析的默认模型与思考程度。',
    },
    en: {
      title: 'Task Analysis Model',
      subtitle: 'Choose the model and reasoning effort used for /things task extraction and progress updates without changing your active chat model.',
      refresh: 'Refresh models',
      refreshShort: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading available models…',
      modelLabel: 'Analysis model',
      effortLabel: 'Reasoning effort',
      recommendedGroup: 'Recommended',
      defaultTitle: 'Automatic · DeepSeek-V4.1-Flash',
      defaultFallbackTitle: 'Automatic · Available lightweight model',
      defaultCurrentTag: 'Default',
      customTag: 'Custom',
      unavailableTag: 'Unavailable',
      defaultSelectedHint: 'Uses DeepSeek-V4.1-Flash (Low reasoning effort) by default when available.',
      customSelectedHint: 'Pinned route: ',
      unavailableBanner: 'Saved model ({saved}) is currently unavailable; analysis will temporarily fall back to {fallback}.',
      unavailableNoFallback: 'Saved model ({saved}) is unavailable and no fallback model was found. Configure a provider in Settings -> Models.',
      providerLoadError: 'Failed to load provider ({name}: {message})',
      searchPlaceholder: 'Search model name or ID…',
      searchClear: 'Clear search',
      emptyModels: 'No available models found. Add a provider or sign in under Settings -> Models.',
      noSearchResults: 'No matching models.',
      effortDefaultLowHint: 'Defaults to Low to balance JSON extraction accuracy and latency.',
      effortUnsupported: 'This model does not expose selectable reasoning levels.',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      resetDefault: 'Reset to default',
      savedOk: 'Saved. Applies on the next analysis run.',
      resetOk: 'Reset to default (DeepSeek-V4.1-Flash · Low).',
      loadFailed: 'Failed to load model settings: ',
      saveFailed: 'Failed to save: ',
      summary: 'Choose the model and reasoning effort for /things background task analysis.',
    },
  };

  function pickClientFlashEffort(reasoning) {
    const efforts = reasoning?.efforts;
    if (!Array.isArray(efforts) || !efforts.length) return '';
    if (efforts.some(e => e.id === 'low')) return 'low';
    if (efforts.some(e => e.id === 'off')) return 'off';
    if (reasoning.defaultEffort && efforts.some(e => e.id === reasoning.defaultEffort)) return reasoning.defaultEffort;
    return efforts[0].id;
  }

  function isClientFlashModel(model) {
    if (!model) return false;
    if (String(model.id || '').toLowerCase() === 'deepseek-flash') return true;
    return /(?:deepseek[-_.\s/]*v?4(?:\.1)?[-_.\s/]*flash|v?4\.1[-_.\s/]*flash)/i.test(`${model.id || ''} ${model.name || ''}`);
  }

  function sameDraft(a, b) {
    const modeA = a?.mode === 'custom' ? 'custom' : 'default';
    const modeB = b?.mode === 'custom' ? 'custom' : 'default';
    if (modeA !== modeB) return false;
    if ((a?.reasoningEffort || null) !== (b?.reasoningEffort || null)) return false;
    if (modeA === 'default') return true;
    return (a?.provider || null) === (b?.provider || null) && (a?.model || null) === (b?.model || null);
  }

  const REFRESH_FULL_MIN_WIDTH = 580;
  const REFRESH_SHORT_MIN_WIDTH = 380;

  function resolveRefreshButtonMode(width) {
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return 'full';
    if (width < REFRESH_SHORT_MIN_WIDTH) return 'icon';
    if (width < REFRESH_FULL_MIN_WIDTH) return 'short';
    return 'full';
  }

  function ThingsAnalysisSettings(props) {
    const [lang, setLang] = useState(() => bridge.getLang());
    const [payload, setPayload] = useState(null);
    const [draft, setDraft] = useState({ mode: 'default', provider: null, model: null, reasoningEffort: null });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [statusMsg, setStatusMsg] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [menuStyle, setMenuStyle] = useState(null);
    const [headWidth, setHeadWidth] = useState(null);

    const headRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const groupsRef = useRef(null);
    const searchRef = useRef(null);
    const dirtyRef = useRef(false);
    const modelFieldId = useId();
    const effortFieldId = useId();
    const menuId = useId();
    const t = ANALYSIS_COPY[lang === 'en' ? 'en' : 'zh'];

    const serverConfig = payload?.config || { mode: 'default', provider: null, model: null, reasoningEffort: null };
    const dirty = Boolean(payload) && !sameDraft(draft, serverConfig);
    dirtyRef.current = dirty;

    const loadConfig = async ({ preserveDraft = false } = {}) => {
      setLoading(true);
      setErrorMsg('');
      try {
        const data = await bridge.getAnalysisConfig();
        setPayload(data);
        if (!preserveDraft || !dirtyRef.current) {
          setDraft({
            mode: data.config?.mode === 'custom' ? 'custom' : 'default',
            provider: data.config?.provider || null,
            model: data.config?.model || null,
            reasoningEffort: data.config?.reasoningEffort || null,
          });
        }
      } catch (err) {
        setErrorMsg(`${t.loadFailed}${err?.message || 'Error'}`);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      let alive = true;
      void loadConfig({ preserveDraft: false });
      const offLocale = bridge.subscribeLocale?.(nextLang => {
        if (!alive) return;
        setLang(nextLang);
        void loadConfig({ preserveDraft: true });
      });
      const onHostCatalogChange = () => {
        if (!alive) return;
        void loadConfig({ preserveDraft: true });
      };
      const offRemote = [];
      try {
        const remote = typeof ctx.get === 'function' ? ctx.get('remote') : null;
        if (typeof remote?.$on === 'function') {
          for (const evName of [
            'llm/adapters-updated',
            'llm/models-updated',
            'settings/document-updated',
            'credentials/record-updated',
            'credentials/reference-updated',
          ]) {
            try { offRemote.push(remote.$on(evName, onHostCatalogChange)); } catch { /* ignore */ }
          }
        }
      } catch { /* remote service optional without hard inject */ }
      const offReset = typeof ctx.on === 'function' ? ctx.on('connection/reset', onHostCatalogChange) : null;
      return () => {
        alive = false;
        offLocale?.();
        for (const off of offRemote) {
          try { off?.(); } catch { /* ignore */ }
        }
        try { offReset?.(); } catch { /* ignore */ }
      };
    }, []);

    useEffect(() => {
      if (!menuOpen || typeof document === 'undefined') return () => {};
      const updateRect = () => {
        const trigger = triggerRef.current;
        if (!trigger || typeof trigger.getBoundingClientRect !== 'function') return;
        const rect = trigger.getBoundingClientRect();
        const vh = typeof window !== 'undefined' ? (window.innerHeight || 800) : 800;
        const vw = typeof window !== 'undefined' ? (window.innerWidth || 1200) : 1200;
        const width = Math.max(260, Math.min(rect.width || 360, vw - 24));
        const left = Math.max(12, Math.min(rect.left, vw - width - 12));
        const spaceBelow = vh - rect.bottom - 14;
        const spaceAbove = rect.top - 14;
        const openUp = spaceBelow < 210 && spaceAbove > spaceBelow;
        const maxHeight = Math.max(160, Math.min(340, openUp ? spaceAbove : spaceBelow));
        setMenuStyle({
          position: 'fixed',
          left: `${Math.round(left)}px`,
          width: `${Math.round(width)}px`,
          maxHeight: `${Math.round(maxHeight)}px`,
          ...(openUp
            ? { bottom: `${Math.round(vh - rect.top + 6)}px`, top: 'auto' }
            : { top: `${Math.round(rect.bottom + 6)}px`, bottom: 'auto' }),
        });
      };
      updateRect();
      const onDown = event => {
        if (triggerRef.current?.contains?.(event.target)) return;
        if (menuRef.current?.contains?.(event.target)) return;
        setMenuOpen(false);
      };
      const onKey = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setMenuOpen(false);
          triggerRef.current?.focus?.();
        }
      };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      window.addEventListener?.('resize', updateRect);
      let stopObserve = null;
      if (typeof uiPrimitives?.observeStickyMenuGroups === 'function' && groupsRef.current) {
        stopObserve = uiPrimitives.observeStickyMenuGroups(groupsRef.current);
      }
      if (searchRef.current) {
        setTimeout(() => { try { searchRef.current?.focus?.(); } catch { /* ignore */ } }, 0);
      }
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener?.('resize', updateRect);
        try { stopObserve?.(); } catch { /* ignore */ }
      };
    }, [menuOpen]);

    useEffect(() => {
      if (props?.view === 'summary') return () => {};
      const el = headRef.current;
      if (!el) return () => {};
      const applyWidth = rawWidth => {
        const w = typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0
          ? rawWidth
          : (el.getBoundingClientRect?.().width || el.clientWidth || 0);
        if (w > 0) {
          const rounded = Math.round(w);
          setHeadWidth(prev => (prev === rounded ? prev : rounded));
        }
      };
      applyWidth();
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(entries => {
          applyWidth(entries?.[0]?.contentRect?.width);
        });
        observer.observe(el);
        return () => observer.disconnect();
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        const onResize = () => applyWidth();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener?.('resize', onResize);
      }
      return () => {};
    }, [props?.view === 'summary']);

    const catalog = payload?.catalog || { groups: [], failures: [], defaultRoute: null };
    const availability = payload?.availability || { savedAvailable: true, fallbackRoute: null };
    const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
    const totalModels = groups.reduce((acc, g) => acc + (g.models?.length || 0), 0);
    const showSearch = totalModels > 4;

    const filteredGroups = useMemo(() => {
      const q = showSearch ? query.trim() : '';
      if (!q) return groups;
      const lower = q.toLowerCase();
      return groups
        .map(group => {
          const models = typeof uiPrimitives?.rankByName === 'function'
            ? uiPrimitives.rankByName(group.models || [], q)
            : (group.models || []).filter(m =>
                String(m.name || '').toLowerCase().includes(lower)
                || String(m.id || '').toLowerCase().includes(lower));
          return { ...group, models };
        })
        .filter(group => group.models.length > 0);
    }, [groups, query, showSearch]);

    if (props?.view === 'summary') {
      return t.summary;
    }

    const findGroupAndModel = (providerId, modelId) => {
      if (!providerId || !modelId) return null;
      const group = groups.find(g => g.id === providerId);
      const model = group?.models?.find(m => m.id === modelId);
      return group && model ? { group, model } : null;
    };

    const selectedEntry = draft.mode === 'custom' ? findGroupAndModel(draft.provider, draft.model) : null;
    const defaultRoute = catalog.defaultRoute || null;
    const effectiveReasoning = draft.mode === 'default'
      ? (defaultRoute?.reasoning || null)
      : (selectedEntry?.model?.reasoning || null);
    const efforts = effectiveReasoning?.efforts || [];
    const effectiveIsFlash = draft.mode === 'default'
      ? Boolean(defaultRoute?.isFlash)
      : isClientFlashModel(selectedEntry?.model);

    let effectiveEffort = '';
    if (efforts.length > 0) {
      if (draft.reasoningEffort && efforts.some(e => e.id === draft.reasoningEffort)) {
        effectiveEffort = draft.reasoningEffort;
      } else if (draft.mode === 'default' || effectiveIsFlash) {
        effectiveEffort = pickClientFlashEffort(effectiveReasoning);
      } else {
        effectiveEffort = effectiveReasoning.defaultEffort || efforts[0].id;
      }
    }

    const activeEffortMeta = efforts.find(e => e.id === effectiveEffort) || null;
    const isCustomMissing = draft.mode === 'custom' && draft.provider && draft.model && !selectedEntry && !loading;

    const triggerLabel = draft.mode === 'default'
      ? (defaultRoute
          ? (defaultRoute.isFlash ? t.defaultTitle : t.defaultFallbackTitle)
          : t.defaultTitle)
      : (selectedEntry ? selectedEntry.model.name : (draft.model || t.defaultTitle));
    const triggerProvider = draft.mode === 'default'
      ? (defaultRoute ? `${defaultRoute.modelName} · ${defaultRoute.providerName}` : '')
      : (selectedEntry ? selectedEntry.group.name : (draft.provider || ''));

    const handlePickDefault = () => {
      setDraft({ mode: 'default', provider: null, model: null, reasoningEffort: null });
      setStatusMsg('');
      setErrorMsg('');
      setMenuOpen(false);
    };

    const handlePickModel = (group, model) => {
      const nextEffort = model.reasoning
        ? (isClientFlashModel(model) ? pickClientFlashEffort(model.reasoning) : (model.reasoning.defaultEffort || model.reasoning.efforts[0]?.id || null))
        : null;
      setDraft({
        mode: 'custom',
        provider: group.id,
        model: model.id,
        reasoningEffort: nextEffort || null,
      });
      setStatusMsg('');
      setErrorMsg('');
      setMenuOpen(false);
    };

    const handleChangeEffort = nextEffort => {
      const normalized = nextEffort || null;
      setDraft(prev => {
        const nextVal = (prev.mode === 'default' && !serverConfig.reasoningEffort && normalized === pickClientFlashEffort(effectiveReasoning))
          ? null
          : normalized;
        return {
          ...prev,
          reasoningEffort: nextVal,
        };
      });
      setStatusMsg('');
      setErrorMsg('');
    };

    const handleSave = async () => {
      if (saving || loading) return;
      setSaving(true);
      setErrorMsg('');
      setStatusMsg('');
      try {
        const res = await bridge.saveAnalysisConfig(draft);
        setPayload(res);
        setDraft({
          mode: res.config?.mode === 'custom' ? 'custom' : 'default',
          provider: res.config?.provider || null,
          model: res.config?.model || null,
          reasoningEffort: res.config?.reasoningEffort || null,
        });
        setStatusMsg(t.savedOk);
      } catch (err) {
        setErrorMsg(`${t.saveFailed}${err?.message || 'Error'}`);
      } finally {
        setSaving(false);
      }
    };

    const handleDiscard = () => {
      if (saving) return;
      setDraft({
        mode: serverConfig.mode === 'custom' ? 'custom' : 'default',
        provider: serverConfig.provider || null,
        model: serverConfig.model || null,
        reasoningEffort: serverConfig.reasoningEffort || null,
      });
      setErrorMsg('');
      setStatusMsg('');
    };

    const canReset = draft.mode === 'custom'
      || draft.reasoningEffort !== null
      || serverConfig.mode === 'custom'
      || serverConfig.reasoningEffort !== null;

    const handleResetDefault = async () => {
      if (saving || loading || !canReset) return;
      if (serverConfig.mode === 'default' && !serverConfig.reasoningEffort) {
        setDraft({ mode: 'default', provider: null, model: null, reasoningEffort: null });
        setErrorMsg('');
        setStatusMsg('');
        return;
      }
      setSaving(true);
      setErrorMsg('');
      setStatusMsg('');
      try {
        const res = await bridge.saveAnalysisConfig({ mode: 'default', reasoningEffort: null });
        setPayload(res);
        setDraft({ mode: 'default', provider: null, model: null, reasoningEffort: null });
        setStatusMsg(t.resetOk);
      } catch (err) {
        setErrorMsg(`${t.saveFailed}${err?.message || 'Error'}`);
      } finally {
        setSaving(false);
      }
    };

    const renderButton = ({ label = null, variant = 'outline', disabled = false, icon = null, className = '', ariaLabel, title, onClick }) => {
      if (uiPrimitives?.Button) {
        const props = { variant, size: 'sm', disabled, icon, className: className || undefined, 'aria-label': ariaLabel, title, onClick };
        return label != null ? h(uiPrimitives.Button, props, label) : h(uiPrimitives.Button, props);
      }
      return h('button', { type: 'button', disabled, className: className || undefined, 'aria-label': ariaLabel, title, onClick }, label != null ? label : (icon || '↻'));
    };

    const renderTag = (text, tone = 'neutral') => {
      if (uiPrimitives?.Tag) {
        return h(uiPrimitives.Tag, { tone }, text);
      }
      return h('span', null, text);
    };

    const nativeValue = draft.mode === 'custom' && draft.provider && draft.model
      ? JSON.stringify([draft.provider, draft.model])
      : '__default__';

    const menuNode = menuOpen && uiPrimitives?.MenuSurface && createPortal && typeof document !== 'undefined' && document.body
      ? createPortal(
          h(uiPrimitives.MenuSurface, {
            ref: menuRef,
            id: menuId,
            className: 'at-dsh-model-menu',
            style: menuStyle || undefined,
            role: 'menu',
            'aria-label': t.modelLabel,
          },
            showSearch && h('div', { className: 'at-dsh-model-menu-search' },
              uiPrimitives.Input
                ? h(uiPrimitives.Input, {
                    ref: searchRef,
                    type: 'text',
                    role: 'searchbox',
                    'aria-label': t.searchPlaceholder,
                    placeholder: t.searchPlaceholder,
                    value: query,
                    onChange: ev => setQuery(ev.target.value),
                  })
                : h('input', {
                    ref: searchRef,
                    type: 'text',
                    placeholder: t.searchPlaceholder,
                    value: query,
                    onChange: ev => setQuery(ev.target.value),
                  }),
              query && h('button', {
                type: 'button',
                className: 'at-dsh-model-menu-search-clear',
                'aria-label': t.searchClear,
                onClick: () => {
                  setQuery('');
                  searchRef.current?.focus?.();
                },
              }, uiPrimitives.IconCloseFillRegular ? h(uiPrimitives.IconCloseFillRegular, { size: 13 }) : '×'),
            ),
            h('div', { ref: groupsRef, className: 'at-dsh-model-menu-groups scrollable' },
              (!query.trim()) && h(uiPrimitives.MenuGroup || 'section', { label: t.recommendedGroup },
                h('button', {
                  type: 'button',
                  role: 'menuitemradio',
                  'aria-checked': draft.mode === 'default',
                  className: 'at-dsh-model-menu-option',
                  onClick: handlePickDefault,
                },
                  h('span', { className: 'at-dsh-model-menu-option-copy' },
                    h('span', { className: 'at-dsh-model-menu-option-name' },
                      defaultRoute?.isFlash !== false ? t.defaultTitle : t.defaultFallbackTitle,
                    ),
                    defaultRoute && h('span', { className: 'at-dsh-model-menu-option-sub' },
                      `${defaultRoute.modelName} · ${defaultRoute.providerName}${defaultRoute.reasoningEffort ? ` · ${defaultRoute.reasoningEffort}` : ''}`,
                    ),
                  ),
                  h('span', { className: 'at-dsh-model-menu-check' },
                    draft.mode === 'default' && (uiPrimitives.IconCheckOutlineRegular ? h(uiPrimitives.IconCheckOutlineRegular, { size: 14 }) : '✓'),
                  ),
                ),
              ),
              filteredGroups.map(group => h(uiPrimitives.MenuGroup || 'section', { key: group.id, label: group.name },
                (group.models || []).map(model => {
                  const selected = draft.mode === 'custom' && draft.provider === group.id && draft.model === model.id;
                  const subText = model.name && model.name !== model.id ? model.id : '';
                  return h('button', {
                    key: `${group.id}:${model.id}`,
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': selected,
                    className: 'at-dsh-model-menu-option',
                    onClick: () => handlePickModel(group, model),
                  },
                    h('span', { className: 'at-dsh-model-menu-option-copy' },
                      h('span', { className: 'at-dsh-model-menu-option-name' }, model.name || model.id),
                      subText && h('span', { className: 'at-dsh-model-menu-option-sub' }, subText),
                    ),
                    h('span', { className: 'at-dsh-model-menu-check' },
                      selected && (uiPrimitives.IconCheckOutlineRegular ? h(uiPrimitives.IconCheckOutlineRegular, { size: 14 }) : '✓'),
                    ),
                  );
                }),
              )),
              totalModels === 0 && h('p', { className: 'at-dsh-plugin-hint', style: { padding: '8px' } }, t.emptyModels),
              totalModels > 0 && filteredGroups.length === 0 && query.trim() && h('p', { className: 'at-dsh-plugin-hint', style: { padding: '8px' } }, t.noSearchResults),
            ),
          ),
          document.body,
        )
      : null;

    const savedMissingInfo = (!availability.savedAvailable && serverConfig.mode === 'custom' && serverConfig.model)
      ? (() => {
          const savedText = `${serverConfig.provider}/${serverConfig.model}`;
          if (availability.fallbackRoute) {
            const fbText = `${availability.fallbackRoute.modelName} (${availability.fallbackRoute.providerName})`;
            return t.unavailableBanner.replace('{saved}', savedText).replace('{fallback}', fbText);
          }
          return t.unavailableNoFallback.replace('{saved}', savedText);
        })()
      : '';

    const refreshMode = resolveRefreshButtonMode(headWidth);
    const refreshAriaLabel = loading ? t.refreshing : t.refresh;
    const refreshLabel = refreshMode === 'icon'
      ? null
      : (refreshMode === 'short' ? t.refreshShort : refreshAriaLabel);
    const refreshClassName = `at-dsh-plugin-refresh-btn${refreshMode === 'icon' ? ' is-icon-only' : ''}${loading ? ' is-loading' : ''}`;

    return h('div', { className: 'at-dsh-plugin-config', 'data-at-dsh-analysis-settings': '1' },
      h('div', { ref: headRef, className: 'at-dsh-plugin-head', 'data-refresh-mode': refreshMode },
        h('div', { className: 'at-dsh-plugin-head-copy' },
          h('h4', { className: 'at-dsh-plugin-title' }, t.title),
          h('p', { className: 'at-dsh-plugin-desc' }, t.subtitle),
        ),
        renderButton({
          label: refreshLabel,
          variant: 'outline',
          disabled: loading || saving,
          className: refreshClassName,
          ariaLabel: refreshAriaLabel,
          title: refreshAriaLabel,
          icon: uiPrimitives?.IconRefreshOutlineRegular ? h(uiPrimitives.IconRefreshOutlineRegular, { size: 13 }) : null,
          onClick: () => { void loadConfig({ preserveDraft: true }); },
        }),
      ),

      errorMsg && h('div', { className: 'at-dsh-plugin-banner at-dsh-plugin-banner-error', role: 'alert' }, errorMsg),
      savedMissingInfo && h('div', { className: 'at-dsh-plugin-banner at-dsh-plugin-banner-warn', role: 'status' }, savedMissingInfo),
      (catalog.failures || []).map(f => h('div', {
        key: f.id,
        className: 'at-dsh-plugin-banner at-dsh-plugin-banner-warn',
        role: 'status',
      }, t.providerLoadError.replace('{name}', f.name || f.id).replace('{message}', f.message || ''))),

      h('div', { className: 'at-dsh-plugin-field' },
        h('div', { className: 'at-dsh-plugin-field-head' },
          h('label', { className: 'at-dsh-plugin-label', htmlFor: modelFieldId }, t.modelLabel),
          draft.mode === 'default'
            ? renderTag(t.defaultCurrentTag, 'info')
            : isCustomMissing
              ? renderTag(t.unavailableTag, 'warning')
              : renderTag(t.customTag, 'neutral'),
        ),
        uiPrimitives?.MenuSurface && createPortal
          ? h('div', null,
              h('button', {
                ref: triggerRef,
                id: modelFieldId,
                type: 'button',
                className: 'at-dsh-model-trigger',
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen,
                'aria-controls': menuOpen ? menuId : undefined,
                disabled: loading || saving,
                onClick: () => {
                  setQuery('');
                  setMenuOpen(prev => !prev);
                },
              },
                uiPrimitives.IconDataOutlineRegular && h(uiPrimitives.IconDataOutlineRegular, { size: 15, className: 'at-dsh-model-chevron' }),
                h('span', { className: 'at-dsh-model-trigger-main' },
                  h('span', { className: 'at-dsh-model-trigger-name' }, loading && !payload ? t.loading : triggerLabel),
                  triggerProvider && h('span', { className: 'at-dsh-model-trigger-provider' }, triggerProvider),
                ),
                uiPrimitives.IconChevronsUpDownOutlineRegular
                  ? h(uiPrimitives.IconChevronsUpDownOutlineRegular, { size: 14, className: 'at-dsh-model-chevron' })
                  : h('span', { className: 'at-dsh-model-chevron' }, '▾'),
              ),
              menuNode,
            )
          : h('select', {
              id: modelFieldId,
              className: 'at-dsh-model-select-native',
              value: nativeValue,
              disabled: loading || saving,
              onChange: ev => {
                const v = ev.target.value;
                if (v === '__default__') {
                  handlePickDefault();
                  return;
                }
                try {
                  const [pid, mid] = JSON.parse(v);
                  const hit = findGroupAndModel(pid, mid);
                  if (hit) handlePickModel(hit.group, hit.model);
                } catch { /* ignore */ }
              },
            },
              h('option', { value: '__default__' }, defaultRoute?.isFlash !== false ? t.defaultTitle : t.defaultFallbackTitle),
              isCustomMissing && h('option', { value: nativeValue, disabled: true }, `${draft.provider}/${draft.model} (${t.unavailableTag})`),
              groups.map(group => h('optgroup', { key: group.id, label: group.name },
                (group.models || []).map(model => h('option', {
                  key: `${group.id}:${model.id}`,
                  value: JSON.stringify([group.id, model.id]),
                }, model.name || model.id)),
              )),
            ),
        h('p', { className: 'at-dsh-plugin-hint' },
          draft.mode === 'default'
            ? t.defaultSelectedHint
            : `${t.customSelectedHint}${selectedEntry ? `${selectedEntry.group.name} / ${selectedEntry.model.name}` : `${draft.provider}/${draft.model}`}`,
        ),
      ),

      h('div', { className: 'at-dsh-plugin-field' },
        h('div', { className: 'at-dsh-plugin-field-head' },
          h('label', { className: 'at-dsh-plugin-label', htmlFor: effortFieldId }, t.effortLabel),
        ),
        efforts.length > 0
          ? (uiPrimitives?.SegmentedControl && efforts.length <= 6
              ? h(uiPrimitives.SegmentedControl, {
                  id: effortFieldId,
                  label: t.effortLabel,
                  value: effectiveEffort,
                  disabled: loading || saving,
                  options: efforts.map(e => ({
                    value: e.id,
                    label: e.name || e.id,
                    ...(e.description ? { title: e.description } : {}),
                  })),
                  onChange: handleChangeEffort,
                })
              : h('select', {
                  id: effortFieldId,
                  className: 'at-dsh-model-select-native',
                  value: effectiveEffort,
                  disabled: loading || saving,
                  onChange: ev => handleChangeEffort(ev.target.value),
                },
                  efforts.map(e => h('option', { key: e.id, value: e.id }, e.name || e.id)),
                ))
          : h('p', { className: 'at-dsh-plugin-hint' }, t.effortUnsupported),
        efforts.length > 0 && h('p', { className: 'at-dsh-plugin-hint' },
          draft.mode === 'default' && effectiveEffort === 'low'
            ? t.effortDefaultLowHint
            : (activeEffortMeta?.description || ''),
        ),
      ),

      h('div', { className: 'at-dsh-plugin-actions' },
        renderButton({
          label: saving ? t.saving : t.save,
          variant: 'primary',
          disabled: !dirty || saving || loading,
          onClick: () => { void handleSave(); },
        }),
        renderButton({
          label: t.discard,
          variant: 'outline',
          disabled: !dirty || saving,
          onClick: handleDiscard,
        }),
        renderButton({
          label: t.resetDefault,
          variant: 'outline',
          disabled: !canReset || saving || loading,
          onClick: () => { void handleResetDefault(); },
        }),
        statusMsg && h('span', { className: 'at-dsh-plugin-status', role: 'status' }, statusMsg),
      ),
    );
  }

  return {
    LeadingRingAnchor,
    ThingsTabTitle,
    ThingsSidebarTab,
    ThingsCommandCard,
    ThingsAnalysisSettings,
  };
}

function installSidebarRingHarness(bridge) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body || typeof installCodexSessionStatus !== 'function') {
    return () => {};
  }

  let reconcileTimer = 0;
  let tick = 0;
  const getMainApi = () => window.__dshSessionStatus || window.__codexSessionStatus || null;
  const clearTimer = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

  const scheduleReconcile = () => {
    if (reconcileTimer) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn => setTimeout(fn, 16));
    reconcileTimer = raf(() => {
      reconcileTimer = 0;
      tick = (tick + 1) % 1000000;
      try {
        document.body?.setAttribute?.('data-at-reconcile-tick', String(tick));
      } catch { /* ignore */ }
    });
  };
  window.__agentThingsScheduleReconcile = scheduleReconcile;

  const harness = {
    globalName: '__dshSessionStatus',
    supportsRequestCancellation: true,
    attributeFilter: ['data-row-key', 'aria-selected', 'data-at-dsh-leading-slot', 'data-at-reconcile-tick', 'hidden', 'style', 'class', 'data-ds-dark-theme'],
    startupRows: () => (typeof document !== 'undefined' ? [...document.querySelectorAll('[data-row-key^="session:"]')] : []),
    isRowSelected: row => row?.getAttribute?.('aria-selected') === 'true',
    async openPane({ entry } = {}) {
      const sid = entry?.threadId || sessionIdFromKey(entry?.key);
      bridge.openSidebarForSession(sid);
      return { delivered: true };
    },
    async locate({ entry, source, analysisMessage }) {
      const sid = entry?.threadId || sessionIdFromKey(entry?.key);
      const ui = getPresentation(bridge.getLang());
      if (analysisMessage) analysisMessage.textContent = ui?.strings?.locatingMessage || 'Locating...';
      const res = await bridge.locateAndJump(sid, source || {});
      if (res?.located) {
        if (analysisMessage) analysisMessage.textContent = res.message || ui?.strings?.locatedMessage || 'Located';
      } else {
        throw new Error(res?.message || ui?.strings?.locateNotFound || 'Source message not found');
      }
    },
    send(rawPayload) {
      Promise.resolve().then(() => bridge.handlePanelPayload(rawPayload, getMainApi()));
    },
    reconcile({ mounted, unmount, attachHost, paint, paintVisibility, openPanel, closePanel, isPanelBusy, isPanelEntry }) {
      if (typeof document === 'undefined') return;
      for (const [row, entry] of [...mounted.entries()]) {
        const slot = [...row.querySelectorAll('[data-at-dsh-leading-slot]')]
          .find(node => node.getAttribute('data-at-dsh-leading-slot') === entry.threadId);
        if (!row.isConnected || !slot || !entry.host.isConnected || !slot.contains(entry.host)) {
          if (isPanelEntry(entry)) {
            if (isPanelBusy?.()) continue;
            closePanel(false);
          }
          unmount(entry);
        }
      }

      for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
        const rowKey = row.getAttribute('data-row-key') || '';
        if (!rowKey.startsWith('session:')) continue;
        const sessionId = rowKey.slice('session:'.length);
        const slot = row.querySelector('[data-at-dsh-leading-slot]');
        if (!sessionId || !slot) continue;

        const key = keyForSession(sessionId);
        const title = resolveSessionTitleFromDom(sessionId) || getPresentation(bridge.getLang())?.strings?.sessionFallbackTitle || 'Session';
        const existing = mounted.get(row);
        if (existing) {
          if (existing.key !== key || existing.slot !== slot) {
            unmount(existing);
          } else {
            if (existing.title !== title) existing.title = title;
            paint(existing);
            continue;
          }
        }

        const { host, button, original } = attachHost(slot, false, null);
        const entry = {
          row,
          slot,
          host,
          button,
          original,
          key,
          threadId: sessionId,
          title,
          hovered: typeof row.matches === 'function' ? row.matches(':hover') : false,
          ringKey: '',
        };
        entry.onEnter = () => { entry.hovered = true; paintVisibility(entry); };
        entry.onLeave = () => { entry.hovered = false; paintVisibility(entry); };
        row.addEventListener('pointerenter', entry.onEnter);
        row.addEventListener('pointerleave', entry.onLeave);
        button.addEventListener('click', event => {
          event.stopPropagation();
          if (isPanelEntry(entry)) closePanel();
          else { closePanel(); openPanel(entry); }
        });
        mounted.set(row, entry);
        paint(entry);
      }
    },
    dispose() {
      // Keep shared global harness intact if an independent embedded card unmounts.
    },
  };

  const priorForeignApi = window.__codexSessionStatus;
  if (priorForeignApi && window.__sessionStatusHarness !== harness) {
    try { priorForeignApi.destroy?.(); } catch { /* ignore */ }
    if (window.__codexSessionStatus === priorForeignApi) {
      delete window.__codexSessionStatus;
    }
  }

  syncDocumentAccent(null, bridge.getLang());
  window.__sessionStatusHarness = harness;
  const version = typeof __AGENT_THINGS_VERSION__ === 'string' ? __AGENT_THINGS_VERSION__ : '';
  installCodexSessionStatus(version, null);
  const mountedApi = getMainApi();
  let wrappedMainApi = null;
  if (mountedApi) {
    mountedApi.receive(bridge.getUiSnapshot());
    bridge.setMainApi(mountedApi);
    // Guard against Antigravity DevTools injector targeting localhost embedded tabs (e.g. http://127.0.0.1:<port>/).
    if (window.__codexSessionStatus === mountedApi) {
      wrappedMainApi = {
        ...mountedApi,
        destroy() {
          try { mountedApi.destroy?.(); } catch { /* ignore */ }
          if (window.__codexSessionStatus === wrappedMainApi) {
            delete window.__codexSessionStatus;
          }
        },
        exportForReload: () => ({ busy: true }),
      };
      window.__codexSessionStatus = wrappedMainApi;
    }
  }

  const panelThemeObserver = typeof MutationObserver === 'function' && document.body
    ? new MutationObserver(() => {
        const nextTheme = syncDocumentAccent(null, bridge.getLang());
        for (const panelRoot of document.querySelectorAll('[data-codex-session-status-panel]')) {
          if (panelRoot.getAttribute('data-color-mode') !== nextTheme.mode) {
            panelRoot.setAttribute('data-color-mode', nextTheme.mode);
          }
        }
      })
    : null;
  panelThemeObserver?.observe(document.body, { childList: true, attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] });

  return () => {
    if (reconcileTimer) {
      clearTimer(reconcileTimer);
      reconcileTimer = 0;
    }
    panelThemeObserver?.disconnect();
    bridge.setMainApi(null);
    try { mountedApi?.destroy?.(); } catch { /* ignore */ }
    if (window.__codexSessionStatus === wrappedMainApi || window.__codexSessionStatus === mountedApi) {
      delete window.__codexSessionStatus;
    }
    if (window.__sessionStatusHarness === harness) {
      delete window.__sessionStatusHarness;
    }
    if (window.__agentThingsScheduleReconcile === scheduleReconcile) {
      delete window.__agentThingsScheduleReconcile;
    }
  };
}

const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace', 'sessions', 'connection'];

function apply(ctx) {
  ctx.effect(() => injectHostLayoutStyles(), 'agent-things: host layout styles');

  const bridge = createDshBridge(ctx);
  bridge.start();
  ctx.effect(() => () => bridge.dispose(), 'agent-things: client bridge');

  if (typeof globalThis !== 'undefined') {
    globalThis.__agentThingsLang = bridge.getLang();
    const create = getPresentationFactory();
    if (create) globalThis.__agentThingsPresentation = create(bridge.getLang());
  }

  ctx.effect(() => installSidebarRingHarness(bridge), 'agent-things: session-status overlay');

  ctx.effect(() => ctx.locale.register(NS, { zh: {}, en: {} }), 'agent-things: locale');

  if (typeof ctx.locale?.subscribe === 'function') {
    ctx.effect(() => ctx.locale.subscribe(() => {
      const lang = bridge.getLang();
      if (typeof globalThis !== 'undefined') {
        globalThis.__agentThingsLang = lang;
        const create = getPresentationFactory();
        if (create) globalThis.__agentThingsPresentation = create(lang);
      }
      bridge.notifyLocale();
      void bridge.refreshSummary();
    }), 'agent-things: locale watch');
  }

  ctx.on('connection/reset', () => {
    bridge.reconnect();
  });

  const {
    LeadingRingAnchor,
    ThingsTabTitle,
    ThingsSidebarTab,
    ThingsCommandCard,
    ThingsAnalysisSettings,
  } = makeUiComponents(ctx, bridge);

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_PROVIDER_ID,
    kind: TAB_KIND,
    multiple: false,
    priority: 'extension',
    title: () => 'Things',
    guide: [{
      id: 'things',
      order: 15,
      title: () => 'Things',
      description: () => getPresentation(bridge.getLang())?.strings?.panelAriaPattern?.replace('{title}', '')?.trim() || 'Session task progress & extracted to-dos',
      icon: () => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
        h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 2, strokeOpacity: 0.25 }),
        h('circle', { cx: 12, cy: 12, r: 9, stroke: '#548eea', strokeWidth: 2, strokeDasharray: '42 60', strokeLinecap: 'round', transform: 'rotate(-90 12 12)' }),
      ),
    }],
  }), 'agent-things: right sidebar tab type');

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_PROVIDER_ID,
    locale: NS,
    inject: sessionId => ({ injectedSessionId: sessionId }),
  }, ThingsSidebarTab)), 'agent-things: right sidebar tab body');

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: TAB_PROVIDER_ID,
    locale: NS,
    inject: sessionId => ({ injectedSessionId: sessionId }),
  }, ThingsTabTitle)), 'agent-things: right sidebar tab title');

  ctx.effect(() => ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
    name: 'sidebar.session.row.leading',
    id: 'agent-things.row-leading',
    order: 5,
    locale: NS,
  }, LeadingRingAnchor)), 'agent-things: session row leading ring');

  ctx.effect(() => ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'things',
    locale: NS,
  }, ThingsCommandCard)), 'agent-things: /things command view');

  ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'agent-things-dsh',
    locale: NS,
  }, ThingsAnalysisSettings)), 'agent-things: bundle config panel');
}

module.exports = {
  inject,
  apply,
  createDshBridge,
  makeUiComponents,
  composeSidebarHtml,
  readHostTheme,
  syncDocumentAccent,
  injectHostLayoutStyles,
  isDarkThemeActive,
};
    return module.exports;
  },
  meta: function() {
    return {};
  }
});
