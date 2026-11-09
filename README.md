# PDF 查看器 · Vue 3

技术栈：Vue 3（Composition API / script setup）、Vite、axios、pnpm。

## 启动

使用 Node.js 22.12.0 和 pnpm 10.20.0，然后在项目根目录运行：

```sh
# 如需安装指定的 pnpm 版本，先执行：
npm install -g pnpm@10.20.0

pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的地址，默认 http://127.0.0.1:5173 。不要直接双击 index.html。

```sh
pnpm test      # 生命周期和资源完整性检查
pnpm build     # 构建到 dist/
pnpm preview   # 本地预览构建结果
```

部署时将 dist/ 整个目录交给静态服务器；支持子目录部署（Vite base 为 ./）。
PDF worker、CMap、标准字体由 predev/prebuild 自动从 pdfjs-dist 复制到 public/pdfjs/。
自带字库位于 public/fonts/，请完整保留。依赖版本由 pnpm-lock.yaml 固定。

## 目录

```text
src/
  App.vue                      页面组合和编辑器组件引用
  components/
    PdfToolbar.vue             工具栏与上传入口
    PdfCanvas.vue              PDF 画布、文字层和加载区域
    MergeRangeDialog.vue       智能合并页码范围
    ShortcutHelpDialog.vue     快捷键一览，列表区域独立滚动
  composables/usePdfEditor.js   初始化、状态、重试、组件卸载
  services/
    http.js                    axios 实例
    font-programs.js           axios 后台加载、分段转换与成功资源缓存
    font-program-store.js     空闲预取、按需等待、失败重试和取消
    pdf-runtime.js             PDF.js 和本地 worker 配置
  modules/pdf/
    createPdfEditor.js         显式创建独立编辑器实例
    smart-merge.js             智能合并与版式识别
    pdf-merge.js               手动合并、取消合并和统一状态
    pdf-json.js                JSON 导入与导出
    pdf-content.js             内容提取、原文字处理、背景预览
    pdf-layout.js              固定框布局、省略号与替换排版
    pdf-fonts.js               字体解析、测量和 PDF 字体嵌入
    pdf-font-settings.js       中文和其他字符字体选择
    pdf-export.js              可复制文本的 PDF 导出
    pdf-overflow.js            显示不完整的区域识别
    pdf-region-editor.js       选中、字号和行间距编辑
    pdf-region-resize.js       拖动、右/下拉伸、键盘和防抖
    pdf-boundaries.js          边界显示
    pdf-session.js             保存页面和恢复页面
  utils/dom-scope.js            监听、定时器、观察器和动态节点清理
  styles/pdf-view.css           编辑器及 PDF 文字层样式
scripts/copy-pdf-resources.mjs  本地 PDF.js 静态资源准备
public/fonts/                  原版本字体二进制和清单
public/pdfjs/                  本地 worker、CMap 和标准字体
```

## 保留的行为

- PDF 上传/拖拽、100 MB 限制、页码跳转、缩放。
- 智能合并页码范围、后台逐页处理、手动合并、取消合并。
- 按 data-id 导入和导出 JSON；导入后的字体选择；纯文本 PDF 导出。
- 蓝/绿/红边界、预览只读、选中/双击、字号/行间距、拖动、右侧/下侧拉伸。
- 方向键实时边框反馈，停止键盘操作 1 秒后更新文字。
- 保存页面、恢复页面、快捷键一览；窄到不显示文字的红框仍能选中调整。
- JSON 导入前不允许区域编辑；导入后锁定合并相关操作；恢复和导出默认第一页。

Vue 管理组件、初始化状态和快捷键帮助弹窗，PDF.js 管理 viewer 内部生成的 DOM。
功能模块用 ES Module 显式导入和实例接口共享状态，不再用 window.PDFTool 注册业务模块。
保留现有的 data-id 和 .pdfmerge 数据协议，避免框架迁移改变识别结果。
PDF.js 保持 3.11.174，与原版本一致；不要单独升级渲染器而不回归校验编号和布局。

axios 用于同源加载字体资源。PDF、导入 JSON 和页面保存文件仍在浏览器本地处理，不会上传到服务器。
依赖安装需要网络；安装完成并构建后，页面所需 worker 和字体均可由本地静态服务器提供。
本次为现有功能的框架迁移，未重新改变智能合并的判断规则。

## Node.js 22.12.0 兼容性

packageManager 已改为 pnpm@10.20.0，避免 pnpm 11 对 Node.js >=22.13 的要求。
Rollup 固定为 4.52.4，锁文件同步更新，避免间接依赖随安装漂移到更高的 Node.js 要求。
保留 Vue、Vite、axios 和 PDF 功能模块；不需要升级现有 Node.js。

## 首屏与字体加载

首次进入和刷新直接显示编辑器，不显示字体加载文字、读条或全屏遮罩。
字库在浏览器空闲时后台预取，大文件分段转换，避免长时间占用主线程。
原 PDF 上传和浏览使用 PDF.js 的原文件字库，不等待替换字库。
导入 JSON、替换排版和导出需要替换字库时，复用后台任务或按需加载完整字库，保持字体一致。
后台失败不阻塞页面；下一次需要字体的操作会重试，成功的字体资源会缓存复用。
