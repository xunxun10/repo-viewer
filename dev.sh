#!/bin/bash

S_DIR=$(dirname $(readlink -m $0))
PKG="$S_DIR/package.json"

function Info(){
    echo -e "\033[32m`date '+%Y-%m-%d %H:%M:%S'` Info: $1\033[0m";
}

function Error(){
    echo -e "\033[31m`date '+%Y-%m-%d %H:%M:%S'` Error: $1\033[0m";
}

function CheckOption(){
    if [ $? -ne 0 ]; then
        Error "$1";
        exit 1;
    fi
}

function _elapsed() {
    local t_start=$1
    local elapsed=$(($(date +%s) - t_start))
    Info "耗时: ${elapsed}s"
}

function show_help() {
    echo "Usage: ./dev.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  new       小版本 +1（如 0.5.2 -> 0.5.3），末位递增"
    echo "  new major 大版本 +1（如 0.5.2 -> 0.6.0），中间位递增、末位归零"
    echo "  chg       将 change_log.txt 修改时间之后的 git 提交记录追加到最新变更"
    echo "  build     运行 npm run dist 构建"
    echo "  pack      构建并打包为完整安装包（含 tar.gz / zip）"
    echo "  incr      生成增量更新包（基于 dist.files.md5 对比）"
    echo "  incr label  仅生成 dist.files.md5 标签文件"
    echo "  clean     清理 dist 目录下的构建产物"
    echo "  push      将本地多个 commit squash 后推送到远程"
    echo "  help      显示此帮助信息"
}

function incr_version() {
    local t_start=$(date +%s)
    local ver=$(grep '"version"' "$PKG" | head -1 | awk -F '"' '{print $4}')
    if [ -z "$ver" ]; then
        Error "无法读取版本号"
        exit 1
    fi

    local major=$(echo "$ver" | cut -d. -f1)
    local minor=$(echo "$ver" | cut -d. -f2)
    local patch=$(echo "$ver" | cut -d. -f3)

    if [ "$1" == "major" ]; then
        local new_minor=$((minor + 1))
        local new_ver="$major.$new_minor.0"
        Info "升级大版本（中间位）"
    else
        local new_patch=$((patch + 1))
        local new_ver="$major.$minor.$new_patch"
        Info "升级小版本（末位）"
    fi

    sed -i "s/\"version\": \"$ver\"/\"version\": \"$new_ver\"/" "$PKG"
    Info "版本号: $ver -> $new_ver"

    # 在 change_log.txt 末尾追加空行和新版本信息
    local changelog="$S_DIR/change_log.txt"
    echo "" >> "$changelog"
    echo "$new_ver" >> "$changelog"
    Info "已更新 $changelog"
    _elapsed $t_start
}

function build(){
    local t_start=$(date +%s)
    Info "Running: npm run dist"
    cd "$S_DIR"/dist &&  rm -rf repo-viewer* repo-viewer-win32-x64*.tar.gz repo-viewer-win32-x64*.zip repo-viewer-win32-x64;
    cd "$S_DIR" && npm run dist;
    _elapsed $t_start "构建"
}

function _detect_platform() {
    if [ `uname -m` == "x86_64" ]; then
        dist_dir="dist/win-unpacked"
        zip_cmd="$S_DIR/node_modules/7zip-bin/win/x64/7za.exe a -tzip"
        label_file="dist.files.md5.win.txt"
        platform_suffix="win"
    elif [ `uname -m` == "aarch64" ]; then
        dist_dir="dist/linux-arm64-unpacked"
        zip_cmd="zip -r"
        label_file="dist.files.md5.txt"
        platform_suffix="linux-arm64"
    else
        Error "不支持的平台";
        exit 1;
    fi
}

function pack(){
    local t_start=$(date +%s)
    local version=$(grep 'version' $S_DIR/package.json | awk -F '"' '{print $4}')

    if [ `uname -m` == "x86_64" ]; then
        Info "开始执行 npm dist 打包命令 ...";
        npm run dist;
        CheckOption "npm run dist 执行失败";

        cd $S_DIR/dist;

        Info "开始将 win-unpacked 打包为 repo-viewer-win32-x64-$version.zip ...";
        rm -rf repo-viewer-win32-x64*.tar.gz repo-viewer-win32-x64*.zip repo-viewer-win32-x64;
        cp -rfa win-unpacked repo-viewer-win32-x64 && 
            $S_DIR/node_modules/7zip-bin/win/x64/7za.exe a -tzip repo-viewer-win32-x64-$version.zip repo-viewer-win32-x64 &&
            rm -rf repo-viewer-win32-x64 &&
            Info "已经成功将 win-unpacked 打包为 repo-viewer-win32-x64-$version.zip";
        CheckOption "打包失败";
    elif [ `uname -m` == "aarch64" ]; then
        Info "开始执行 npm run arm 打包命令 ...";
        npm run arm;
        CheckOption "npm run arm 执行失败";

        # linux同时打出增量包
        incr;

        cd $S_DIR/dist;

        Info "开始将 linux-arm64-unpacked 打包为 repo-viewer-linux-arm64-$version.zip ...";
        rm -rf *.AppImage *.tar.gz *.zip repo-viewer-linux-arm64;
        mv linux-arm64-unpacked repo-viewer-linux-arm64 && 
            zip -r -s 40m repo-viewer-linux-arm64-$version.zip repo-viewer-linux-arm64 &&
            mv repo-viewer-linux-arm64 linux-arm64-unpacked &&
            Info "已经成功将 linux-arm64-unpacked 打包为 repo-viewer-linux-arm64-$version.zip 及分片文件";
        CheckOption "打包失败";
    fi

    _elapsed $t_start "pack"
}

function incr(){
    _detect_platform

    local t_start=$(date +%s)
    local label_flag=$1
    local version=$(grep 'version' $S_DIR/package.json | awk -F '"' '{print $4}')

    if [ -n "$label_flag" ]; then
         find ./$dist_dir/ -type f | xargs md5sum | sort > "$label_file"
         Info "已生成标签文件: $label_file";
         _elapsed $t_start
         return 0
    fi

    local new_md5=$(find ./$dist_dir/ -type f | xargs md5sum | sort)
    local old_md5=$(cat "$label_file" | sort)

    if [ "$new_md5" == "$old_md5" ]; then
        Info "文件未变化"
        _elapsed $t_start
        return 0
    fi

    local incr_dir="./dist/incr"
    local diff_files=$(diff <(echo "$new_md5") <(echo "$old_md5") | grep "^< " | sed -r 's#.*\s\*?./dist#./dist#g')
    Info "文件有变化:\n$diff_files"

    local incr_zip="dist/repo-viewer.$version.$platform_suffix.incr.zip"

    rm -rf "$incr_dir" "$incr_zip"  && mkdir -p "$incr_dir"
    CheckOption "创建增量目录失败"

    for file in $diff_files; do
        Info "处理文件: $file"
        local rel_path=${file#./$dist_dir/}
        local rel_dir=$(dirname "$rel_path")
        mkdir -p "$incr_dir/$rel_dir"
        CheckOption "创建增量目录失败"
        cp "$file" "$incr_dir/$rel_path"
        CheckOption "复制文件失败"
    done

    Info "压缩增量文件到 $incr_zip"
    $zip_cmd "$incr_zip" $incr_dir/*;
    CheckOption "压缩 $incr_zip"
    _elapsed $t_start "incr"
}

function clean(){
    _detect_platform
    Info "开始清理 $S_DIR/$dist_dir  $S_DIR/dist/incr"
    rm -rf $S_DIR/$dist_dir $S_DIR/dist/incr;
}

function push(){
    local t_start=$(date +%s)

    local branch=$(git rev-parse --abbrev-ref HEAD)
    Info "当前分支: $branch"

    git fetch origin "$branch"
    CheckOption "git fetch 失败"

    local ahead=$(git rev-list --count @{u}..HEAD 2>/dev/null)
    if [ $? -ne 0 ]; then
        Error "没有上游分支，请先设置 upstream"
        exit 1
    fi

    if [ "$ahead" -eq 0 ]; then
        Info "没有需要推送的提交"
        _elapsed $t_start
        return
    fi

    if [ "$ahead" -eq 1 ]; then
        Info "仅 1 个提交，直接推送..."
        git push origin "$branch"
        CheckOption "git push 失败"
        Info "推送成功"
        _elapsed $t_start
        return
    fi

    local messages=$(git log --reverse --format="- %s" @{u}..HEAD | awk '!seen[$0]++')

    echo ""
    echo "以下 $ahead 个提交将被 squash 为 1 个提交："
    echo "$messages"
    echo ""
    read -p "是否继续? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        Info "已取消"
        _elapsed $t_start
        return
    fi

    Info "本地领先远程 ${ahead} 个提交，开始 squash..."

    git reset --soft HEAD~$ahead
    CheckOption "git reset 失败"

    local msg=$(echo "$messages"; echo "")
    git commit -e -m "$msg"
    CheckOption "git commit 失败"

    Info "Squash 完成，开始推送..."
    git push --force-with-lease origin "$branch"
    CheckOption "git push 失败"

    Info "推送成功"
    _elapsed $t_start
}

function chg(){
    local t_start=$(date +%s)
    local changelog="$S_DIR/change_log.txt"
    local git_dir="$S_DIR"

    # 获取 change_log.txt 的最后修改时间（兼容 Linux/macOS）
    local mtime
    if [[ "$OSTYPE" == "darwin"* ]]; then
        mtime=$(stat -f %m "$changelog")
    else
        mtime=$(stat -c %Y "$changelog")
    fi

    # 获取该时间之后的 git 提交记录（排除 merge 提交）
    local new_entries
    new_entries=$(cd "$git_dir" && git log --since="@$mtime" --format="- %s" --no-merges --reverse 2>/dev/null)

    if [ -z "$new_entries" ]; then
        Info "没有新的 git 提交记录"
        _elapsed $t_start
        return
    fi

    Info "发现新的提交记录："
    echo "$new_entries"

    # 过滤掉已存在于 change_log.txt 中的条目，再插入到最新变更后
    local filtered=""
    while IFS= read -r entry; do
        if ! grep -qF -- "$entry" "$changelog" 2>/dev/null; then
            filtered="${filtered}${entry}"$'\n'
        fi
    done <<< "$new_entries"
    # 去掉末尾换行
    filtered=${filtered%$'\n'}

    if [ -z "$filtered" ]; then
        Info "所有条目均已存在，无需追加"
        _elapsed $t_start
        return
    fi

    Info "新增不重复的条目："
    echo "$filtered"

    # 追加到文件末尾
    echo "" >> "$changelog"
    echo "$filtered" >> "$changelog"

    local count=$(echo "$filtered" | wc -l)
    Info "已追加 ${count} 条记录到 change_log.txt"
    _elapsed $t_start
}

case "$1" in
    new)
        incr_version "$2"
        ;;
    chg)
        chg
        ;;
    build)
        build
        ;;
    pack)
        pack
        ;;
    incr)
        incr "$2"
        ;;
    clean)
        clean
        ;;
    push)
        push
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
       build
        ;;
esac
