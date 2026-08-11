#!/bin/zsh

set -e

cd "${0:A:h}"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js 20 或更新版本。"
  echo "安装说明：https://nodejs.org/"
  read "?按回车关闭……"
  exit 1
fi

node -e 'if (Number(process.versions.node.split(".")[0]) < 20) { console.error("需要 Node.js 20 或更新版本，当前为 " + process.versions.node); process.exit(1); }'

(sleep 1; open "http://127.0.0.1:4317") &
exec node server.mjs
