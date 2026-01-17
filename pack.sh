#!/bin/bash

S_DIR=$(dirname $(readlink -m $0));

function Info(){
    # 打印日期和时间
    echo -e "\033[32m`date '+%Y-%m-%d %H:%M:%S'` Info: $1\033[0m";
}

function Error(){
    # 打印日期和时间
    echo -e "\033[31m`date '+%Y-%m-%d %H:%M:%S'` Error: $1\033[0m";
}

function CheckOption(){
    # 检查上个命令返回值，如果不为0则打印错误信息并退出
    if [ $? -ne 0 ]; then
        Error "$1";
        exit 1;
    fi
}

op_flag=$1;	# claen


if [ `uname -m` == "x86_64" ]; then
    dist_dir="dist/win-unpacked"
elif [ `uname -m` == "aarch64" ]; then
    dist_dir="dist/linux-arm64-unpacked"
else
    Error "不支持的平台";
    exit 1;
fi

if [ "$op_flag" == 'clean' ]; then
    Info "开始清理 $S_DIR/$dist_dir  $S_DIR/dist/incr"
    rm -rf $S_DIR/$dist_dir $S_DIR/dist/incr;
    exit 0;
fi

version=$(grep 'version' $S_DIR/package.json | awk -F '"' '{print $4}')

# 如果是x86平台，将 win-unpacked mv 为 repo-viewer-win32-x64, 并压缩为tar.gz包，然后mv回来
if [ `uname -m` == "x86_64" ]; then
    Info "开始执行nmp dist打包命令 ...";
    npm run dist;
    CheckOption "npm run dist 执行失败";

    cd $S_DIR/dist;

    Info "开始将 win-unpacked 打包为 repo-viewer-win32-x64-$version.tar.gz ...";
    rm -rf repo-viewer-win32-x64*.tar.gz repo-viewer-win32-x64;
    cp -rfa win-unpacked repo-viewer-win32-x64 && 
        tar -zcf repo-viewer-win32-x64-$version.tar.gz repo-viewer-win32-x64 &&
        rm -rf repo-viewer-win32-x64 &&
        Info "已经成功将 win-unpacked 打包为 repo-viewer-win32-x64-$version.tar.gz";
    CheckOption "压缩程序文件失败";
elif [ `uname -m` == "aarch64" ]; then
    # 如果是arm平台，将 linux-arm64-unpacked mv 为 repo-viewer-linux-arm64, 并压缩为tar.gz包，然后mv回来
    Info "开始执行nmp arm 打包命令 ...";
    npm run arm;
    CheckOption "npm run arm 执行失败";

    cd $S_DIR/dist;

    Info "开始将 linux-arm64-unpacked 打包为 repo-viewer-linux-arm64-$version.tar.gz ...";
    rm -rf *.AppImage *.tar.gz *.zip repo-viewer-linux-arm64;
    mv linux-arm64-unpacked repo-viewer-linux-arm64 && 
        tar -zcf repo-viewer-linux-arm64-$version.tar.gz repo-viewer-linux-arm64 &&
        split -b 40m repo-viewer-linux-arm64-$version.tar.gz repo-viewer-linux-arm64-$version.tar.gz.part. &&
        rename 's/$/.zip/' repo-viewer-linux-arm64-$version.tar.gz.part.* &&
        mv repo-viewer-linux-arm64 linux-arm64-unpacked &&
        Info "已经成功将 linux-arm64-unpacked 打包为 repo-viewer-linux-arm64-$version.tar.gz";
    CheckOption "压缩程序文件失败";
else
    Error "不支持的平台";
fi
