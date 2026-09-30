# 获取 Playwright 与 Electron Fork

主仓库通过 submodule 锁定两个源码仓库：

| 路径 | 来源 | 当前提交 |
| --- | --- | --- |
| `thirdparty/playwright` | jt-jiangtao/playwright | `2b32735c21cc17880dcf14b8c1b5594c39d45338` |
| `thirdparty/electron` | jt-jiangtao/electron | `0343e0193a6d593287df7bb0a95765afa35ed7e1` |

新机器拉取（将占位地址替换为主仓库地址）：

```sh
git clone --recurse-submodules <主仓库地址>
```

已有主仓库检出：

```sh
git submodule update --init --recursive
git submodule status
```

更新主仓库后同样执行初始化命令。子仓库有未提交修改时先保存工作；不要用 `--force` 覆盖修改。版本跟随主仓库记录的提交，不自动跟随 Fork 的 main。

## 查看与提交源码改动

```sh
git status --short
git -C thirdparty/playwright status --short
git -C thirdparty/playwright diff
git -C thirdparty/electron status --short
git -C thirdparty/electron diff
```

主仓库显示子仓库的脏状态与提交指针，具体代码差异属于对应子仓库。新文件在子仓库 `status` 中显示，尚未加入索引时不会出现在普通 `diff` 中。

先在相应 Fork 审查、验证、提交代码，并将该提交发布到对应 Fork 远端；再在主仓库更新源码指针。只提交主仓库指针不会上传子仓库文件。表中两个自有提交已推送至各自远端的 `codex/fork-baseline`，并通过 `git ls-remote` 确认远端引用；主仓库 gitlink 可供递归拉取。

注册后源码目录的 `.git` 是文本文件，分别指向主仓库 `.git/modules/playwright` 和 `.git/modules/electron`；Git 元数据仍存在。`thirdparty/electron` 是直属源码 submodule；gclient 工作区位于 `thirdparty/build/electron-workspace`，Chromium 位于其 `src`，其中 `src/electron` 是同提交的独立构建检出。

## Chromium 与构建依赖

递归 clone 只获取上述两个 Fork，不下载 Chromium、工具链或二进制。工具放 `thirdparty/tools`，导出产物放 `thirdparty/build`，下载放 `thirdparty/downloads`，日志放 `thirdparty/logs`；这些目录保持忽略。

直属源码是修改和提交的位置，构建工作区只消费已提交源码。准备构建前从项目根执行下列步骤；工作树有改动时停止，不执行强制覆盖：

```sh
(
  set -e
  source_dir="$PWD/thirdparty/electron"
  build_dir="$PWD/thirdparty/build/electron-workspace/src/electron"
  test -z "$(git -C "$source_dir" status --porcelain)"
  source_commit="$(git -C "$source_dir" rev-parse HEAD)"
  if [ ! -e "$build_dir" ]; then
    mkdir -p "$(dirname "$build_dir")"
    git clone --no-hardlinks "$source_dir" "$build_dir"
    git -C "$build_dir" remote set-url origin https://github.com/jt-jiangtao/electron.git
  fi
  test -z "$(git -C "$build_dir" status --porcelain)"
  git -C "$build_dir" fetch "$source_dir" HEAD
  git -C "$build_dir" checkout --detach "$source_commit"
  test "$(git -C "$build_dir" rev-parse HEAD)" = "$source_commit"
)
```

独立检出不共享 .git 元数据，不自动跟随 main。首次准备依照锁定版本的 CONTRIBUTING 安装 Electron 构建依赖；当前迁移已复制忽略的依赖和生成文件。目录移动可能使绝对路径缓存失效，不能承诺零重编。

准备 depot_tools 后，将下列配置保存为 `thirdparty/build/electron-workspace/.gclient`。如果已有工作区，先检查现有配置，不覆盖用户修改。

```python
solutions = [
  {
    "name": "src/electron",
    "url": "https://github.com/jt-jiangtao/electron",
    "deps_file": "DEPS",
    "managed": False,
    "custom_deps": {
      "src": "https://github.com/chromium/chromium.git@51dd6cfc5c0bb8a297725ae9270ca43fb0fcc8e2",
    },
    "custom_vars": {},
  },
]
```

在项目根目录执行，使用既有基线 depot_tools `41c9bd890277c2f551499d171d215dfdf5dab97d`。首次准备先在已有 `src` 中初始化 Chromium Git 并获取锁定提交，再调用 gclient，避免 gclient 首次 clone 的自动目录搬迁失败路径：

```sh
(
  set -e
  export PATH="$PWD/thirdparty/tools/depot_tools:$PATH"
  export DEPOT_TOOLS_UPDATE=0
  cd thirdparty/build/electron-workspace
  if [ ! -e src/.git ]; then
    git -C src init
    git -C src remote add origin https://github.com/chromium/chromium.git
  fi
  if ! git -C src rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C src fetch origin 51dd6cfc5c0bb8a297725ae9270ca43fb0fcc8e2
    git -C src checkout --detach FETCH_HEAD
  fi
  source_commit="$(git -C ../../electron rev-parse HEAD)"
  test "$(git -C src/electron rev-parse HEAD)" = "$source_commit"
  gclient sync --revision="src/electron@$source_commit"
)
```

该步骤不使用清理或强制覆盖参数。锁定版本的 `gclient_scm.py` 支持 独立 Electron 构建检出的 Git 元数据。注意：若直接让 gclient 在没有 Chromium `.git` 的非空 `src` 中首次 clone，clone 失败时工具会自动将整个 `src` 搬到 `_bad_scm`，即使没有 `--force`；构建检出会随目录搬迁。上面的预初始化确保进入既有 Git 工作区同步路径；fetch 或 checkout 失败时 `set -e` 会停止，不继续调用 gclient。

同步前保存子仓库未提交改动，并核对 `git -C src/electron rev-parse HEAD`、`git -C src/electron status --short` 和 `.git` 文件；同步后再次核对。依赖下载和 hooks 失败时保留现场，不使用 reset、clean 或强制同步补救。当前已完成原工作区 Chromium 构建；迁移后没有重新下载完整 Chromium 或运行全部 hooks，新机器首次依赖同步仍需实际验证。

后续构建与产物导出参见根目录 README 的自有 Electron 桌面宿主说明。源码拉取成功不代表构建、来源校验或打包成功。
