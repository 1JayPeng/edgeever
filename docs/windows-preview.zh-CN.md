# Windows x64 预览版

## 分发状态

EdgeEver 通过受维护 Fork 的 [GitHub Releases](https://github.com/1JayPeng/edgeever/releases/latest)
页面分发 Windows x64 预览版。当前安装包与应用内可执行文件尚未使用
Authenticode 签名，因此 Windows SmartScreen、杀毒软件或组织策略可能提示风险或
直接阻止安装。这类提示是预览阶段的预期现象，但并不表示任意来源的副本都安全。

- 仅从 `1JayPeng/edgeever` 官方 Release 下载。
- 不要为 EdgeEver 关闭 SmartScreen、杀毒软件或组织安全控制。
- 如果组织策略阻止安装，请先使用 Web/PWA 客户端，等待后续
  Authenticode 签名版本。

## 自动更新

安装包未签名并不会阻止 NSIS 更新器下载和安装后续 Release。EdgeEver 增加了独立
信任门禁，避免更新通道只依赖同样未签名的 `latest.yml`：

1. 客户端读取 `latest.yml` 发现新版本，但此时不会开始 Windows 下载。
2. 客户端从该版本的官方 Release 获取 `latest-windows.json` 与
   `latest-windows.json.sig`。
3. 客户端使用安装包内固定的公钥验证 Ed25519 签名，并要求版本、文件名、大小与
   SHA-512 和 `latest.yml` 完全一致。
4. 客户端自动下载安装包，再用已签名清单核验其大小、SHA-512 与 SHA-256。
5. 只有通过本地文件复核的安装包，才能在用户确认重启时安装，或在用户退出
   EdgeEver 时自动安装。

清单缺失、密钥未知、签名无效、版本不一致或安装包被修改时，更新一律停止。
Windows 安装包未通过最终本地校验前，应用不会开启退出时自动安装。

该机制保护更新决策和安装包字节，但不会消除首次安装时的 Windows 信誉提示、
不会在资源管理器中提供发布者身份，也无法绕过组织的应用控制策略；这些能力仍需
可信 Authenticode 签名。

## Release 资产与离线签名

每个正式 Release 包含以下 Windows 资产：

- `EdgeEver-<version>-windows-x64.exe`
- `edgeever-self-hosted-<version>-windows-x64.zip`
- `latest.yml`
- `latest-windows.json`
- `latest-windows.json.sig`
- `SHA256SUMS-windows.txt`

self-hosted ZIP 仅包含编译后的运行时、前端资源、migrations 和 `release.json`；
不得包含 SQLite/WAL 数据、resources 或凭据文件。其名称、大小、SHA-256、版本与
revision 会在签名 `latest-windows.json` 前绑定。

该 Fork 的 GitHub Actions 构建并验证五项未签名输入（安装包、self-hosted ZIP、
`latest.yml`、清单和校验和），再上传为 Actions artifact。它刻意不创建 Release、
不上传 Release 资产，也不读取签名私钥。操作员下载精确 artifact，验证 tag/revision
及 ZIP 布局，创建 Draft Release，使用
`EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY` 指向的仓库外密钥在本机为精确清单离线签名，
上传全部六项资产，再下载 Draft 资产，重新执行签名、安装包、ZIP hash 与内嵌
`release.json` 的完整审计后才公开发布。

## Self-hosted Windows 包

将 ZIP 解压到可替换的应用目录，绝不能解压到数据目录。编译后的可执行文件会自动发现
解压后的资产；不要设置 `EDGE_EVER_APP_DIR`。必须为其设置应用目录外的绝对
`EDGE_EVER_DATA_DIR`；仅允许绑定 loopback。

```powershell
$app = 'C:\EdgeEver\app\1.90.1'
$env:EDGE_EVER_DATA_DIR = "$env:LOCALAPPDATA\edgeever-local"
$env:EDGE_EVER_HOST = '127.0.0.1'
$env:EDGE_EVER_PORT = '18789'
# 仅首次启动：只设置一种认证来源。优先使用仅所有者可读的文件。
$env:EDGE_EVER_AUTH_PASSWORD_FILE = '<绝对路径：仅所有者可读的密码文件>'
& "$app\edgeever-self-hosted.exe"
Invoke-RestMethod 'http://127.0.0.1:18789/api/health'
```

不得将密码文件、SQLite 数据库、`-wal`、`-shm`、resources 或
`edgeever-secrets.json` 放在 `$app` 下或 ZIP 中。升级时先正常停止服务，对外部
数据目录执行冷备份，再只替换 `$app`。数据目录保持不变。若迁移已执行，仅可通过
同时恢复匹配的旧应用目录和冷备份回滚；不要用旧二进制启动已迁移的数据。

私钥必须是 Ed25519 PKCS#8 PEM 文件，必须保存在仓库外，并在另一个安全位置留有
备份。发布 shell 使用绝对路径配置：

```bash
export EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY=/absolute/path/to/windows-update-ed25519-private.pem
```

Fork 信任锚的密钥 ID 为 `edgeever-fork-windows-update-2026-09`，SPKI DER SHA-256
指纹为 `d7a861ef54f4000fe7f0d29e805d4f4f732b4808301c6dbaa4a6de86242d156c`。

该 Fork 不持有上游签名私钥。因此现有上游安装无法通过自动更新迁移：请从
`1JayPeng/edgeever` 手动下载并安装首个 Fork Release。后续 Fork Release 使用
固定的 Fork 密钥正常自动更新。不得为不同公钥复用上游密钥 ID。

本地私钥缺失或与桌面客户端固定的公钥不匹配时，Release 会保持 Draft。今后 Fork
密钥轮换必须由当前受信 Fork 密钥签名，经过两个 Release 完成过渡。

## 未来迁移到 Authenticode

获得可信证书后：

1. 签署所有随包发布的 PE，包括 `EdgeEver.exe`、Rust sidecar、辅助可执行文件和
   最终 NSIS 安装包。
2. 把证书精确主题配置为 electron-builder 的 `publisherName`，让已签名客户端
   强制校验发布者连续性。
3. 必须在全部 Authenticode 签名完成后再生成 `latest.yml`、EdgeEver 签名清单与
   校验和，因为签名会改变文件字节。
4. 迁移期间及迁移后继续保留独立 Ed25519 门禁。现有未签名预览版没有声明
   Authenticode 发布者，因此可以接收首个已签名安装包；新签名客户端随后会对后续
   更新增加发布者校验。

首次公开 Windows 平台属于用户可感知的新平台，必须按 SemVer 使用 minor 递增，
不能作为 patch 发布。
