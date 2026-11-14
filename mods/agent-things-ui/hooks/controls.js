import { CONTENT_WIDTH, colors, svg, slider, primary, clearButton, paneIcon, PANE_ICON_WIDTH } from './presentation.js';
import { progressValue, progressState } from './progress.js';

export default function controls(props, surface) {
  const current = surface.state;
  if (!current || current.received !== props.value && !current.dragging && !current.editingNumber) {
    surface.setState({ received: props.value, value: props.value, dragging: false });
  }
  const state = surface.state || { received: props.value, value: props.value, dragging: false };
  const update = (value, dragging) => {
    value = progressValue(value, dragging);
    surface.setState({ ...surface.state, received: props.value, value, dragging });
    return value;
  };
  const pointerValue = event => ((event.fine?.x ?? event.x + .5) / Math.max(1, surface.columns) * CONTENT_WIDTH - 7) / (CONTENT_WIDTH - 14) * 100;
  surface.onPointer(event => {
    if (props.disabled || event.button && event.button !== 'left') return;
    const latest = surface.state || state;
    if (props.kind === 'icon') {
      // 只有右侧图标区域可点；左侧留给悬停提示。
      const x = (event.fine?.x ?? event.x + .5) / Math.max(1, surface.columns) * PANE_ICON_WIDTH;
      const inside = x >= 74 && x <= PANE_ICON_WIDTH + 2 && event.y >= 0 && event.y <= surface.rows;
      if (event.type === 'enter' || event.type === 'move') surface.setState({ ...latest, hovered: inside });
      if (event.type === 'leave') surface.setState({ ...latest, hovered: false, pressed: false });
      if (event.type === 'down' && inside) surface.setState({ ...latest, hovered: true, pressed: true });
      if (event.type === 'up' && latest.pressed) {
        surface.setState({ ...latest, hovered: inside, pressed: false });
        if (inside) surface.post({ action: props.action });
      }
      return;
    }
    if (props.kind === 'button') {
      // Desktop reports whole cells; include each region's final partial cell.
      const inside = event.x >= 0 && event.x <= surface.columns && event.y >= 0 && event.y <= surface.rows;
      if (event.type === 'enter' || event.type === 'move') surface.setState({ ...latest, hovered: inside });
      if (event.type === 'leave') surface.setState({ ...latest, hovered: false });
      if (event.type === 'down' && inside) surface.setState({ ...latest, hovered: true, pressed: true });
      if (event.type === 'up' && latest.pressed) {
        surface.setState({ ...latest, hovered: inside, pressed: false });
        if (inside) surface.post({ action: props.action });
      }
      return;
    }
    const y = (event.fine?.y ?? event.y + .5) / Math.max(1, surface.rows) * 110;
    if (event.type === 'down') {
      if (y < 45) {
        if (event.x / Math.max(1, surface.columns) > .66) surface.setState({ ...latest, editingNumber: true, buffer: latest.value == null ? '' : String(latest.value), selectAll: true });
      } else { surface.setState({ ...latest, editingNumber: false }); update(pointerValue(event), true); }
    } else if (event.type === 'move' && latest.dragging) {
      update(pointerValue(event), true);
    } else if (event.type === 'up') {
      if (latest.dragging) {
        surface.post({ value: update(pointerValue(event), true) });
        surface.setState({ ...surface.state, dragging: false });
      }
    }
  });
  surface.onKey(event => {
    if (props.disabled) return;
    if ((props.kind === 'button' || props.kind === 'icon') && ['return', 'enter', ' '].includes(event.key)) surface.post({ action: props.action });
    if (props.kind === 'slider') {
      const latest = surface.state || state;
      if (latest.editingNumber) {
        if ((event.ctrl || event.meta) && event.key.toLowerCase() === 'a') {
          surface.setState({ ...latest, selectAll: true }); return;
        }
        if (event.key === 'return' || event.key === 'enter') {
          surface.setState({ ...latest, editingNumber: false }); return;
        }
        let buffer = latest.buffer;
        if (/^\d$/.test(event.key)) buffer = latest.selectAll ? event.key : buffer + event.key;
        else if (event.key === 'backspace') buffer = latest.selectAll ? '' : buffer.slice(0, -1);
        else if (event.key === 'delete') buffer = '';
        else return;
        const value = buffer === '' ? null : progressValue(Number(buffer));
        if (value !== null) buffer = String(value);
        surface.setState({ ...latest, value, buffer, selectAll: false });
        surface.post({ value });
      } else {
        if (event.key === 'left' || event.key === 'right') {
          surface.post({ value: update((latest.value || 0) + (event.key === 'left' ? -1 : 1), false) });
        }
        if (event.key === 'enter' || event.key === 'return') surface.setState({ ...latest, editingNumber: true, buffer: latest.value == null ? '' : String(latest.value), selectAll: true });
      }
    }
  });
  if (props.kind === 'slider') {
    const color = colors[state.value == null ? props.state : progressState(props.state, state.value)] || colors.unstarted;
    const number = state.editingNumber ? state.buffer || '—' : state.value ?? '—';
    const selection = state.editingNumber && state.selectAll ? '<rect x="214" y="5" width="65" height="30" rx="3" fill="#0169cc30"/>' : '';
    const caret = state.editingNumber && !state.selectAll ? '<path d="M281 7V33" stroke="#0169cc"/>' : '';
    const picture = svg(`${selection}<text x="0" y="28" font-size="11" fill="currentColor" opacity=".68">进度</text><text x="279" y="30" text-anchor="end" font-size="27" font-weight="550" fill="currentColor">${number}</text>${caret}<text x="288" y="26" font-size="12" fill="currentColor" opacity=".68">%</text><path d="M214 41H279" stroke="currentColor" opacity=".2"/><g transform="translate(0 55)">${slider(state.value, color)}</g>`, CONTENT_WIDTH, 110);
    // The desktop Client tree accepts Svg nodes although its terminal element table has no Svg constructor.
    return { type: 'Svg', props: { source: picture, alt: `进度 ${state.value ?? '未记录'}%`, width: 4096, height: 110 } };
  }
  if (props.kind === 'icon') return { type: 'Svg', props: { source: paneIcon(state.hovered, state.pressed), alt: props.label, width: 4096, height: 28 } };
  return { type: 'Svg', props: { source: props.action === 'clear' ? clearButton(state.hovered, state.pressed) : primary(props.label, props.disabled, state.hovered, state.pressed && state.hovered), alt: props.label, width: 4096, height: props.action === 'clear' ? 28 : 36 } };
}
