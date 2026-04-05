# AI策略交易系统-币安实盘

本项目是受NOF1AI启发开发的一个可以在浏览器中运行的由AI驱动的全自动加密货币合约交易助手：
- 自动从币安期货（USDⓈ-M 永续）获取行情，计算 EMA/RSI/MACD 等指标，并生成中文解读报告。
- 支持连接任何兼容 OpenAI 格式的 AI 模型（如 OpenAI、DeepSeek、Qwen、Gemini 等）。
- 一键解析并执行 AI 指令（下单、平仓、设置 TP/SL、撤单等）到你的币安合约账户。
- 全程在浏览器本地运行，不需要后端服务。

---

## 你需要准备什么
- 一台电脑和一个现代浏览器（推荐 Chrome）以及VPN(推荐香港、日本、新加坡节点)。
- 如果要“实盘执行”：币安“合约（USDⓈ-M 永续）”的 API Key 与 Secret，并已开通交易权限。
- 如果要调用 AI：任何兼容 OpenAI 格式的 API Key，以及对应的 Base URL 和模型 ID。
- 需要在Chrome浏览器安装CORS UNBLOCK扩展，否则会导致下单操作失败。

---

## 如何启动
- 直接双击打开 `trading.html` 即可使用。


---

## 快速上手
1) 打开页面后，顶部/底部会滚动显示多种交易对的最新价格；左侧每张卡片会自动生成中文报告（含 EMA/RSI/MACD 与 24h 统计）。
2) 如果要用 AI：
   - 在“AI 交互模块”里填写 Base URL（如 `https://api.openai.com/v1/chat/completions`）。
   - 填写模型 ID（如 `gpt-4o`、`deepseek-reasoner`、`qwen-max` 等）。
   - 在“API Key”框里粘贴你的密钥并点击“保存Key”。
   - 在“自定义策略”里写下你的规则（例如：短线回撤买入、风控要求、目标位等）。
   - 勾选你想分析的交易对（最多 6 个），点击“发送一次”。
   - AI 的回复会包含严格 JSON 的“指令块”，下方“解析与执行”卡片会显示可执行的纯命令行预览。
3) 如果要“实盘执行”：
   - 在“全局设置”里输入你的币安 API Key 和 Secret，点击“保存并启用实盘”。
   - 页面会开始每 2 秒刷新你的账户、持仓和委托，图表会采样账户权益曲线。
   - 在“解析与执行”卡片点击“解析并执行一次”，或开启“跟随AI刷新自动执行”。
   - 第三列支持“撤销全部委托”“平所有持仓”，以及在持仓/委托表格中点选行后进行相应操作。

---

## 支持的 AI 模型
本系统支持任何兼容 OpenAI API 格式的模型，只需填写：
- **Base URL**：API 端点地址，如：
  - OpenAI: `https://api.openai.com/v1/chat/completions`
  - DeepSeek: `https://api.deepseek.com/v1/chat/completions`
  - Qwen（国内）: `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
  - Qwen（国际）: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions`
  - Gemini: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
  - 其他兼容 OpenAI 格式的服务
- **模型 ID**：如 `gpt-4o`、`deepseek-reasoner`、`qwen-max`、`gemini-2.5-pro` 等
- **API Key**：对应平台的 API 密钥

---

## 目录结构
- `trading.html`：主页面（UI 布局与各模块入口）。
- `main.js`：全部核心逻辑（行情抓取、指标计算、AI 调用、JSON 解析、实盘执行、图表与表格渲染）。
- `ai_config.js`：AI 提供商与“严格 JSON 指令”要求的集中配置。
- `styles.css`：暗色主题与页面样式（PC 与移动端适配）。

---

## 重要安全说明
- 你的币安 API Key 和 Secret只保存在浏览器 `localStorage`，不会上传到别人服务器。
- 实盘执行直接对你的真实账户下单。务必：
  - 先小额试验，严格设置 `SL`（止损），控制杠杆和风险。
  - 不要在公共/不安全环境使用；关闭浏览器前确认已撤掉不必要委托。
- 若使用 AI 自动执行：
  - 系统有“策略约束”过滤（例如开仓必须有 `SL`），但它无法代替你对风险的判断。
  - 自动执行会记录本地日志与累计时长，避免误触也应谨慎使用。

---

## 常见问题
- AI 回复没有 JSON 指令怎么办？
  - 系统会追加一次"仅输出 JSON"的请求作为兜底；你也可以手动点击"解析并执行一次"查看解析结果。
- 为什么最多只能选 6 个交易对？
  - 为了让 AI 聚焦高质量信息并控制调用成本，系统限制一次最多 6 个。
- 实盘刷新频率可以改吗？
  - 目前账户/持仓/委托默认每 2 秒刷新；价格 WS 每秒更新。你可以自行调整代码中的刷新间隔。
- 如何使用自定义模型？
  - 只需填写对应的 Base URL、模型 ID 和 API Key 即可。系统支持任何兼容 OpenAI API 格式的服务。

---

## 故障排查
- 币安接口报 418（IP 被临时限制）
  - 系统会自动退避 2 分钟后重试。请降低请求频率或稍后再试。
- 显示"状态：错误"或数据长期不更新
  - 检查网络是否允许访问 `https://fapi.binance.com` 与 `wss://fstream.binance.com`；可能是公司/地区网络屏蔽。
- AI 提示错误（如 401、403、404 等）
  - 请检查 Base URL 是否正确、API Key 是否有效、模型 ID 是否存在。
- AI 返回地区限制错误
  - 可更换网络环境或使用其他兼容 OpenAI 格式的模型服务。

---

## 提示与建议
- 先不填任何实盘密钥，熟悉界面与 AI 指令格式（`ai_config.js` 中的 JSON 模板）。
- 写策略时务必包含风控与退出条件，系统也会强制校验开仓需提供止损（SL）。
- 观察第三列的账户权益曲线与持仓/委托变化，逐步确认策略和执行效果后再考虑自动化。
- 不同 AI 模型的输出质量和风格可能不同，建议测试多个模型找到最适合的。

