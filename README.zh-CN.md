# MiniDB

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![CI](https://github.com/puppy-stars/Mini-DB/actions/workflows/ci.yml/badge.svg)](https://github.com/puppy-stars/Mini-DB/actions/workflows/ci.yml)

MiniDB 是一个 VS Code 数据库扩展，让你可以直接在编辑器里浏览和查询 MySQL、PostgreSQL、SQLite、SQL Server 和 Oracle。

## 功能亮点

- 保存并管理多个数据库连接
- 直接在 VS Code 中执行 SQL、查看结果和查询历史
- 浏览表、视图、索引、约束、触发器和表关系
- 支持表数据导入与导出
- 支持通过 SSH 隧道连接远程数据库
- 使用 VS Code Secret Storage 存储密码和 SSH 密钥信息
- 支持中英文界面切换

## 支持的数据库

- MySQL
- PostgreSQL
- SQLite
- SQL Server
- Oracle

## 环境要求

- VS Code `1.85.0` 或更高版本
- 本地开发需要 Node.js `20`

## 本地开发快速开始

安装依赖：

```bash
npm install
```

编译扩展：

```bash
npm run compile
```

运行 lint 和测试：

```bash
npm run lint
npm test
```

在开发模式下启动扩展：

1. 用 VS Code 打开当前项目。
2. 运行 `npm run compile`。
3. 按 `F5` 启动 Extension Development Host。

## 打包

生成本地 `.vsix` 包：

```bash
npx @vscode/vsce package
```

如果你打算通过 GitHub 而不是 VS Code Marketplace 分发 MiniDB，可以把生成好的 `.vsix` 文件直接作为 GitHub Release 附件上传。

## 项目说明

- SQLite 连接使用本地数据库文件路径。
- SSH 隧道会绑定到随机的本地 `127.0.0.1` 端口。
- Oracle 连接使用 `oracledb` Node 驱动；根据你的平台环境，可能还需要额外的 Oracle 客户端配置。

## 安全与隐私

- 连接元数据保存在 VS Code global state 中。
- 数据库密码和 SSH 敏感信息保存在 VS Code Secret Storage 中。
- 不要提交本地 VS Code 存储、导出的连接数据、包含账号密码的截图，或带有敏感信息的测试数据库。

## 参与贡献

欢迎一起改进 MiniDB。开发环境、代码约定和 Pull Request 说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

如果要提交问题，请优先使用 GitHub 的 Issue 模板，方便我们更快复现和定位。

## 发布前建议

- 给仓库首页补几张截图或一段演示 GIF。
- 创建 GitHub Release，并把生成好的 `.vsix` 包作为附件上传。
- 在你计划支持的操作系统上各跑一遍验证。

## 许可证

[MIT](./LICENSE)
