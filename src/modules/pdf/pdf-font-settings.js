
/** JSON 导入后的全文件字体选择；字体状态独立于文本映射。 */

  const options = Object.freeze([
    ['simsun', '宋体'], ['nsimsun', '新宋体'], ['sans-serif', 'sans-serif']
  ]);
  const defaults = () => ({ enabled: false, chinese: 'simsun', other: 'nsimsun' });
  export const PDFFontSettings = Object.freeze({ create: scope => {
    const { document, window, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, MutationObserver } = scope;
    let state = defaults(), pending = null, previousFocus = null;
    const dialog = document.createElement('dialog');
    dialog.className = 'pdf-font-dialog';
    dialog.setAttribute('aria-labelledby', 'pdfFontTitle');
    dialog.innerHTML = `<form method="dialog">
      <h2 id="pdfFontTitle">选择页面字体</h2>
      <p>应用到当前 PDF 的所有页面，包括未替换的文字。</p>
      <label>中文<select name="chinese" aria-label="中文字体"></select></label>
      <label>其他字符<select name="other" aria-label="其他字符字体"></select></label>
      <p class="font-hint">其他字符包括非中文的字母、数字、标点及符号。保留原字号和固定区域；超出区域仍以省略号和红框提示。缺字时使用备用字库。</p>
      <div class="font-actions"><button type="button" data-cancel>暂不调整</button><button type="submit">应用字体</button></div>
    </form>`;
    document.body.append(dialog);
    const chinese = dialog.querySelector('[name="chinese"]'), other = dialog.querySelector('[name="other"]');
    for (const select of [chinese, other]) for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value; option.textContent = label; select.append(option);
    }
    const valid = value => options.some(([key]) => key === value);
    const finish = value => {
      const resolve = pending; pending = null;
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
      previousFocus = null;
      resolve?.(value);
    };
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      if (valid(chinese.value) && valid(other.value)) finish({ enabled: true, chinese: chinese.value, other: other.value });
    });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); finish(null); });
    dialog.addEventListener('close', () => { if (!dialog.open && pending) finish(null); });
    return Object.freeze({
      get enabled() { return state.enabled; },
      get chinese() { return state.chinese; },
      get other() { return state.other; },
      snapshot: () => ({ ...state }),
      restore: value => {
        if (!value || !valid(value.chinese) || !valid(value.other)) throw new Error('无效的字体设置');
        state = { enabled: !!value.enabled, chinese: value.chinese, other: value.other };
      },
      choose: () => {
        finish(null);
        chinese.value = state.chinese; other.value = state.other;
        previousFocus = document.activeElement;
        return new Promise(resolve => { pending = resolve; dialog.showModal(); chinese.focus(); });
      },
      reset: () => { finish(null); state = defaults(); }
    });
  }});
