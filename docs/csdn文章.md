# 我做了一款软考 AI 笔记客户端：本地记笔记、论文计字，写完还能让 AgentScope 评分润色

> **适合平台**：CSDN / 掘金  
> **建议标题**：我用 Vue3 + Electron 做了个软考 AI 笔记客户端：论文计字、AI 评分润色都有了  
> **标签**：Electron、Vue3、TypeScript、AgentScope、Spring Boot、软考、桌面应用、Markdown  
> **封面建议**：三栏工作区截图（学科 / 笔记列表 / 论文编辑器）

---

备考软考这几年，我最烦两件事：

一是知识点散落在各种文档、云笔记、截图里，换台电脑就找不到；  
二是下午论文，摘要卡 300 字、正文卡 2000～2500 字，Word 里数格子既不准又折磨人。写完还得自己对照评分标准抠「切题、实践、结构、表达」。

所以我做了 **软考通**：一款本地优先的软考备考笔记桌面端。它不只是记笔记，论文练习时实时按软考习惯统计字数，写完还可以交给 AI 评分、润色，并给出修改意见。

技术栈很克制：

- **桌面端**：Vue 3 + TypeScript + Electron
- **AI 后端**：Spring Boot + **AgentScope 2.x（Java）**
- **数据**：笔记全部落本地 Markdown，不登录、不上传

需要源码的同学可以私信我。

---

## 一、它到底能干什么

| 能力 | 说明 |
|------|------|
| 分学科 | 架构、高项、软设、网工、库工等常见科目一键切换 |
| 本地仓库 | 自己选一个文件夹当笔记根目录，应用按科目自动建目录 |
| 知识点笔记 | 富文本工具栏（标题 / 字号 / 对齐 / 下划线 / 列表），保存为 Markdown |
| 截图粘贴 | 粘贴或拖入图片，存到 `assets/`，Markdown 里引用相对路径 |
| 论文练习 | 题目、摘要、正文分块编辑；摘要 ≤300 字，正文建议 2000～2500 字 |
| 字数统计 | 汉字 1 字、英文/数字整词 1 字、标点 1 字，贴近考场习惯 |
| AI 润色 | 可单独润色摘要、正文，或一次润色全部 |
| AI 评分 | 按 75 分制打分（≥45 合格），给维度分、优点和改进建议 |
| 拖动排序 | 笔记列表原生拖拽，顺序写入 `.order.json` |

不启动 AI 后端时，记笔记、写论文、打包安装包照样能用。AI 是可选插件，不是强绑定。

---

## 二、为什么做成桌面端，而不是又一个 Web 笔记

备考资料往往带项目经历、架构图、论文底稿，我不希望默认就上云。

所以产品原则是：

1. **本地优先**：选一个文件夹，笔记就是普通 `.md`，VS Code、Typora、Obsidian 都能打开。
2. **无登录**：打开就能写，配置只记「根目录 + 上次科目」。
3. **AI 解耦**：桌面端只负责编辑和展示；评分 / 润色走本机 HTTP（默认 `127.0.0.1:9001`）。

目录约定很简单：

```text
你的目录/
  architect/          # 系统架构设计师
    notes/            # 知识点 .md
    notes/assets/     # 截图
    notes/.order.json
    essays/           # 论文练习 .md
    essays/assets/
    essays/.order.json
  pm/                 # 高项
    notes/
    essays/
  ...
```

论文落盘时按固定结构组装，方便以后用别的编辑器继续改：

```markdown
---
title: "论大模型智能运维技术及应用"
type: essay
updatedAt: "2026-08-15T12:00:00.000Z"
---

# 论大模型智能运维技术及应用

## 题目描述

（首行题目名 + 下方题目背景与写作要求）

## 摘要

……

## 正文

……
```

---

## 三、整体架构

```text
┌─────────────────────────────────────────────┐
│                 软考通 桌面端                 │
│  Vue 3 + Pinia + Vue Router（渲染进程）       │
│           ↕ preload + contextBridge          │
│  Electron 主进程（fs / dialog / IPC）         │
│           读写本地 Markdown / 图片            │
└──────────────────────┬──────────────────────┘
                       │ HTTP JSON
                       ▼
┌─────────────────────────────────────────────┐
│         Spring Boot + AgentScope 2.x         │
│   POST /api/ai/essay/polish   论文润色        │
│   POST /api/ai/essay/score    论文评分        │
│   ReActAgent（无记忆、无工具，一次一评）        │
└─────────────────────────────────────────────┘
```

进程划分：

| 层 | 技术 | 职责 |
|----|------|------|
| 渲染进程 | Vue 3、Pinia、marked / turndown | UI、字数、论文结构、调 AI |
| 预加载 | `contextBridge` | 只暴露受控 `window.api`，不把 Node 直接塞给页面 |
| 主进程 | Electron + Node `fs` | 选目录、读写笔记、存图、排序 |
| AI 服务 | Java AgentScope 2.x | 按软考论文标准润色、打分 |

工程用 **electron-vite** 把主进程、preload、渲染进程打在一起，开发时热更新，发布用 **electron-builder** 打 Mac DMG / Windows 安装包。

---

## 四、Electron 安全桥：页面不直接碰文件系统

渲染进程不能 `require('fs')`。所有本地 IO 都走 IPC。

preload 里只暴露白名单方法：

```ts
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  ensureSubject: (rootPath, subjectId) =>
    ipcRenderer.invoke('notes:ensureSubject', rootPath, subjectId),
  listNotes: (rootPath, subjectId, kind) =>
    ipcRenderer.invoke('notes:list', rootPath, subjectId, kind),
  readNote: (rootPath, subjectId, kind, fileName) =>
    ipcRenderer.invoke('notes:read', rootPath, subjectId, kind, fileName),
  writeNote: (payload) => ipcRenderer.invoke('notes:write', payload),
  saveNotesOrder: (payload) => ipcRenderer.invoke('notes:saveOrder', payload),
  saveImage: (payload) => ipcRenderer.invoke('notes:saveImage', payload),
}

contextBridge.exposeInMainWorld('api', api)
```

窗口创建时打开隔离：

```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
}
```

主进程这边，选目录用系统对话框，科目目录按需创建：

```ts
ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择笔记保存目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('notes:ensureSubject', async (_e, rootPath, subjectId) => {
  ensureSubjectDirs(rootPath, subjectId)
})
```

```ts
export function ensureSubjectDirs(rootPath: string, subjectId: string): void {
  ensureDir(join(rootPath, subjectId, 'notes'))
  ensureDir(join(rootPath, subjectId, 'essays'))
  ensureDir(join(rootPath, subjectId, 'notes', 'assets'))
  ensureDir(join(rootPath, subjectId, 'essays', 'assets'))
}
```

读图还有一层路径约束：只允许 `assets/` 下的相对路径，拒绝 `..`，避免任意读盘。

---

## 五、论文练习：结构拆开，字数按考场习惯算

软考论文不是「一个大文本框」。客户端拆成三块：

1. **题目**：首行当题目名称，下面贴题目描述和要求
2. **摘要**：硬限制 300 字
3. **正文**：建议 2000～2500 字，底部实时变色提示

字数规则刻意贴近考场，而不是 `text.length`：

- 中文每个汉字计 **1**
- 英文 / 数字连续串（整个单词）计 **1**，中间加空格就变成两个词
- 标点计 **1**
- 空白不计

```ts
export function countExamWords(text: string): number {
  if (!text) return 0
  const matches = text.match(
    /[\u4e00-\u9fff]|[A-Za-z0-9]+|[^\s\u4e00-\u9fffA-Za-z0-9]/g,
  )
  return matches ? matches.length : 0
}
```

界面上摘要超 300 会标红禁止保存；正文落在 2000～2500 显示为合适区间。

打开 / 保存 / AI 润色之后，还会做一次「章节消毒」：摘要框里如果误带了 `## 正文`，会截断，避免三个框互相污染。这对从 Word 粘贴、或模型偶尔把结构标题一起吐出来特别有用。

论文 Markdown 组装大致如下：

```ts
export function buildEssayMarkdown(parts: EssayParts): string {
  const cleaned = sanitizeEssayParts(parts)
  const title = cleaned.title || '未命名论文'
  const topicBlock = cleaned.prompt.trim() || title
  return `---
title: "${title.replace(/"/g, '\\"')}"
type: essay
updatedAt: "${new Date().toISOString()}"
---

# ${title}

## 题目描述

${topicBlock}

## 摘要

${cleaned.abstract}

## 正文

${cleaned.body}
`
}
```

知识点笔记走另一条路：`contenteditable` 编辑，保存时 **turndown** 转 Markdown，打开时 **marked** 转回 HTML。标题只写 YAML frontmatter，正文不再重复插 `# 标题`，避免每次保存叠一层标题。

---

## 六、AI 评分与润色：桌面端只负责「问」和「展示」

前端请求很薄，默认打本机 `9001`：

```ts
const AI_BASE =
  import.meta.env.VITE_AI_BASE_URL || 'http://127.0.0.1:9001'

export function polishEssay(payload: EssayPolishRequest) {
  return postJson('/api/ai/essay/polish', payload)
}

export function scoreEssay(payload: {
  subject: string
  topic: string
  abstractText: string
  bodyText: string
}) {
  return postJson('/api/ai/essay/score', payload)
}
```

润色可以指定 `part`：`abstract` / `body` / `all`。写回编辑器前同样走 `sanitizeEssayParts`，防止模型把「## 摘要」这类结构标题带回来。

评分弹窗直接消费后端 JSON：

- `totalScore`：总分，满分 75
- `level`：合格 / 不及格（≥45 合格）
- `dimensions`：切题、实践、结构、表达等维度分 + 评语
- `strengths` / `improvements`：优点和改进建议

```ts
async function runScore() {
  const res = await scoreEssay({
    subject: store.subject.name,
    topic: topic.value.trim(),
    abstractText: abstractText.value,
    bodyText: body.value,
  })
  scoreResult.value = res
  scoreOpen.value = true
  status.value = `AI 评分完成：${res.totalScore} 分（${res.level || '-'}）`
}
```

开发环境在 `.env.development` 里配：

```bash
VITE_AI_BASE_URL=http://127.0.0.1:9001
```

---

## 七、后端：AgentScope 2.x Java 实现论文智能体

论文润色、评分都属于「一次任务、不要记忆」的场景。我没有用带 Redis 会话的长对话 Agent，而是每次请求新建一个 **ReActAgent**：

- 无 Toolkit（不需要搜网页、不需要调工具）
- 无会话记忆、无压缩
- 系统提示词里写死软考论文规则
- 强制模型只吐 JSON，方便桌面端直接渲染

依赖（AgentScope Java 2.x）：

```xml
<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope-core</artifactId>
    <version>2.0.0</version>
</dependency>
<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope-extensions-model-openai</artifactId>
    <version>2.0.0</version>
</dependency>
```

模型走 OpenAI 兼容协议，本地 Ollama、DeepSeek、通义等都可以换 `baseUrl`：

```java
@Configuration
public class EssayAgentConfig {

    @Bean
    public Model chatModel(
            @Value("${essay.llm.base-url}") String baseUrl,
            @Value("${essay.llm.api-key}") String apiKey,
            @Value("${essay.llm.model}") String modelName) {
        return OpenAIChatModel.builder()
                .baseUrl(baseUrl)
                .apiKey(apiKey)
                .modelName(modelName)
                .stream(false)
                .build();
    }
}
```

评分 Agent 的核心：注入「软考下午论文」身份，要求按 75 分制输出结构化结果。

```java
@Service
public class EssayAiService {

    private final Model chatModel;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public EssayAiService(Model chatModel) {
        this.chatModel = chatModel;
    }

    public EssayScoreResponse score(EssayScoreRequest req) {
        ReActAgent agent = ReActAgent.builder()
                .name("ruankao-essay-score")
                .sysPrompt(SCORE_PROMPT)
                .model(chatModel)
                .toolkit(new Toolkit())
                .build();

        Msg reply = agent.call(new UserMessage(buildScoreUserText(req))).block();
        return parseScore(reply.getTextContent());
    }

    public EssayPolishResponse polish(EssayPolishRequest req) {
        ReActAgent agent = ReActAgent.builder()
                .name("ruankao-essay-polish")
                .sysPrompt(POLISH_PROMPT)
                .model(chatModel)
                .toolkit(new Toolkit())
                .build();

        Msg reply = agent.call(new UserMessage(buildPolishUserText(req))).block();
        return parsePolish(req.getPart(), reply.getTextContent());
    }
}
```

系统提示词是效果的关键。评分侧我会明确告诉模型：你不是通用作文老师，而是软考阅卷老师。

```java
private static final String SCORE_PROMPT = """
    你是软考高级/中级下午论文阅卷老师。满分 75 分，45 分及格。
    结合科目、题目要求、摘要和正文，从下面维度打分：
    1. 切合题意（20）
    2. 应用深度与技术方案（20）
    3. 实践性与角色贡献（15）
    4. 结构完整性（摘要/背景/问题/对策/效果）（10）
    5. 表达与条理性（10）
    要求：
    - 只输出 JSON，不要 Markdown 代码块
    - 分数必须是整数，总分等于各维度之和
    - 摘要超过 300 字、正文明显不足 2000 或严重超 2500，要在 improvements 里指出
    JSON 字段：
    {
      "totalScore": 0,
      "level": "合格|不及格",
      "summary": "总评",
      "dimensions": [{"name":"","score":0,"max":0,"comment":""}],
      "strengths": [],
      "improvements": []
    }
    """;
```

润色侧则强调「像考生自己改稿」，不要写成 AI 腔，也不要发明没写过的项目：

```java
private static final String POLISH_PROMPT = """
    你是软考论文写作教练。请润色考生文稿，保留其项目事实，不要编造经历。
    摘要控制在 300 字以内；正文尽量落在 2000～2500 字。
    按 part 只改对应部分：abstract / body / all。
    只输出 JSON：
    {"part":"abstract|body|all","abstractText":"","bodyText":""}
    未修改的字段也要原样带回。
    """;
```

Controller 对上桌面端路径：

```java
@RestController
@RequestMapping("/api/ai/essay")
public class EssayAiController {

    private final EssayAiService essayAiService;

    public EssayAiController(EssayAiService essayAiService) {
        this.essayAiService = essayAiService;
    }

    @PostMapping("/polish")
    public EssayPolishResponse polish(@RequestBody EssayPolishRequest req) {
        return essayAiService.polish(req);
    }

    @PostMapping("/score")
    public EssayScoreResponse score(@RequestBody EssayScoreRequest req) {
        return essayAiService.score(req);
    }
}
```

为什么这里用 **独立 ReActAgent**，而不是带记忆的 HarnessAgent？

论文评分如果把上一篇稿子的上下文带进来，分数会被污染。每次新建 Agent，等价于「换一份卷子、换一个阅卷老师」，结果更稳，也更省 token。

模型返回偶尔会包一层 \`\`\`json，解析前要剥一下：

```java
private String unwrapJson(String raw) {
    String text = raw == null ? "" : raw.trim();
    if (text.startsWith("```")) {
        text = text.replaceAll("^```(?:json)?\\s*", "")
                   .replaceAll("\\s*```$", "");
    }
    int start = text.indexOf('{');
    int end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return text.substring(start, end + 1);
    }
    throw new IllegalStateException("模型未返回 JSON");
}
```

---

## 八、列表拖动排序：不引入第三方拖拽库

中间栏用原生 `draggable`。拖动过程中 Pinia 即时换位，松手后把文件名数组写进 `.order.json`。

```ts
function onDragOver(e: DragEvent, fileName: string): void {
  e.preventDefault()
  if (!dragFrom.value || dragFrom.value === fileName) return
  const fromIndex = store.notes.findIndex((n) => n.fileName === dragFrom.value)
  const toIndex = store.notes.findIndex((n) => n.fileName === fileName)
  if (fromIndex < 0 || toIndex < 0) return
  store.moveNote(fromIndex, toIndex)
}

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  await store.persistNotesOrder()
}
```

列表读取时：排序表里有的按表排，没有出现过的文件按修改时间补在后面。新建默认插到最前，删除 / 重命名会同步维护这份顺序。

---

## 九、本地跑起来

桌面端（Node.js 18+）：

```bash
cd ruankaotong
npm install
npm run dev
```

需要 AI 时，先启动 Java 后端（默认 9001），再确认：

```bash
VITE_AI_BASE_URL=http://127.0.0.1:9001
```

打包：

```bash
npm run dist:mac   # macOS DMG
npm run dist:win   # Windows NSIS + 便携包
```

未配置苹果 / 微软代码签名时，别人第一次打开可能被系统拦截，需要在「隐私与安全性」里允许，或右键打开。正式分发再补签名即可。

---

## 十、几个做下来比较有用的点

1. **笔记是 Markdown，不是私有库。** 卸载应用不会带走仓库；换编辑器也不怕被锁死。
2. **字数规则要单独写。** `length` 对英文单词和标点都不符合软考直觉，正则按「汉字 / 整词 / 标点」切一次就够用。
3. **AI 不要塞进 Electron 主进程。** 模型、提示词、JSON 解析都放 Java 服务里，桌面端保持可独立分发。
4. **评分 Agent 不要记忆。** 论文是试卷，不是聊天。AgentScope 的 ReActAgent 很适合这种一次性任务。
5. **模型输出要契约化。** 弹窗、维度分、优缺点列表全靠 JSON 字段，提示词里把 schema 写死，解析失败再兜底。

---

## 写在最后

软考通解决的是我自己备考时的真实摩擦：知识点要本地可检索，论文要能看见字数，写完还想有个「阅卷老师」给修改意见。

它不是又一个 ChatGPT 套壳，而是：

**本地 Markdown 仓库 + 软考论文编辑器 + AgentScope 2.x 评分润色智能体。**

前端 Vue 3 / Electron，后端 Java AgentScope 2.x，两边通过两个 HTTP 接口对接，结构很干净。

如果这篇文章对你有帮助，欢迎点赞收藏。  
**需要完整源码（桌面端 + AI 后端）的同学，私信我即可。**

（配图建议：工作区全貌、论文字数条、AI 评分弹窗各一张。）
