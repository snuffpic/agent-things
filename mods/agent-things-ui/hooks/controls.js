import { CONTENT_WIDTH, colors, svg, slider, primary, clearButton, paneIcon, paneIconWidth, measureButtonWidth, measureClearWidth } from './presentation.js';
import { progressValue, progressState } from './progress.js';

export default function controls(props, surface) {
  const sliderWidth = Number.isFinite(Number(props.width)) && Number(props.width) > 0
    ? Math.max(130, Math.round(Number(props.width)))
    : CONTENT_WIDTH;
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
  const pointerValue = event => ((event.fine?.x ?? event.x + .5) / Math.max(1, surface.columns) * sliderWidth - 7) / (sliderWidth - 14) * 100;
  surface.onPointer(event => {
    if (props.disabled || event.button && event.button !== 'left') return;
    const latest = surface.state || state;
    if (props.kind === 'icon') {
      // 只有右侧图标区域可点；左侧留给悬停提示。
      const totalWidth = paneIconWidth(props.label);
      const x = (event.fine?.x ?? event.x + .5) / Math.max(1, surface.columns) * totalWidth;
      const inside = x >= (totalWidth - 30) && x <= totalWidth + 2 && event.y >= 0 && event.y <= surface.rows;
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
    const hitThreshold = Math.min(0.85, Math.max(0.66, (sliderWidth - 96) / sliderWidth));
    if (event.type === 'down') {
      if (y < 45) {
        if (event.x / Math.max(1, surface.columns) > hitThreshold) surface.setState({ ...latest, editingNumber: true, buffer: latest.value == null ? '' : String(latest.value), selectAll: true });
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
    const numRight = sliderWidth - 25;
    const pctX = sliderWidth - 16;
    const selX = sliderWidth - 90;
    const caretX = sliderWidth - 23;
    const selection = state.editingNumber && state.selectAll ? `<rect x="${selX}" y="5" width="65" height="30" rx="3" fill="#0169cc30"/>` : '';
    const caret = state.editingNumber && !state.selectAll ? `<path d="M${caretX} 7V33" stroke="#0169cc"/>` : '';
    const progressWord = props.progressLabel || '进度';
    const unrecordedWord = props.unrecordedWord || '未记录';
    const picture = svg(`${selection}<text x="0" y="28" font-size="11" fill="currentColor" opacity=".68">${progressWord}</text><text x="${numRight}" y="30" text-anchor="end" font-size="27" font-weight="550" fill="currentColor">${number}</text>${caret}<text x="${pctX}" y="26" font-size="12" fill="currentColor" opacity=".68">%</text><path d="M${selX} 41H${numRight}" stroke="currentColor" opacity=".2"/><g transform="translate(0 55)">${slider(state.value, color, sliderWidth)}</g>`, sliderWidth, 110, 'xMinYMid meet');
    // The desktop Client tree accepts Svg nodes although its terminal element table has no Svg constructor.
    return { type: 'Svg', props: { source: picture, alt: `${progressWord} ${state.value ?? unrecordedWord}%`, width: sliderWidth, height: 110 } };
  }
  if (props.kind === 'icon') return { type: 'Svg', props: { source: paneIcon(state.hovered, state.pressed, props.label), alt: props.label, width: paneIconWidth(props.label), height: 28 } };
  const buttonWidth = props.action === 'clear'
    ? (props.label === '清除进度' || !props.label ? 64 : measureClearWidth(props.label))
    : measureButtonWidth(props.label);
  return { type: 'Svg', props: { source: props.action === 'clear' ? clearButton(state.hovered, state.pressed, props.label, buttonWidth) : primary(props.label, props.disabled, state.hovered, state.pressed && state.hovered, buttonWidth), alt: props.label, width: buttonWidth, height: props.action === 'clear' ? 28 : 36 } };
}
