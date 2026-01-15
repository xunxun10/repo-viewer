// 程序入口

const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process');
const path = require('path')
const si = require('systeminformation');
const crypto = require('crypto');
const RepoViewer = require('./module/repo_viewer')
const ViewerDb = require('./module/viewer_db')
const MyConf = require('./util/my_conf')
const MyFile = require('./util/my_file')
const {MyDate} = require('./util/my_util')
const MyLog = require('./util/my_log')
const MyOs = require('./util/my_os')

const is_mac = process.platform === 'darwin'
const is_windows = process.platform === 'win32';

function GetOsType(){
    if(process.platform === 'darwin'){
        return 'mac'
    }else if(process.platform === 'win32'){
        return 'windows'
    }else{
        // process.platform在Linux: 返回 "linux"  FreeBSD: 返回 "freebsd"
        return 'linux'
    }
}
const os_type = GetOsType()

// 修复窗口在弹出alert等弹框后失去焦点的bug
// let need_focus_fix = false, triggering_programmatic_blur = false;


var G_CAN_APP_EXIST = false;    // 是否可以退出

var g_conf = null
var g_sys_params = {
    local_data_dir: path.join(app.getPath('userData'), 'repo-viewer.local'),
    db_file_name: "data.db",
    config_file_name: 'sys.conf',
    tmp_dir: '',
    db_file: null,
    user: "",
    password: "",
    cur_repo_viewer: null,
    encryp_key: null,
    repo_cache_dir: "",
    ide_cmd: '',
}

var viewer_db = new ViewerDb();

// 菜单详情
function CreateMenu(){
    return Menu.buildFromTemplate([
        {
          label: 'Data',
          submenu: [
            {
                label:'set password',
                click: () => { CallWeb('open-password-panel', g_sys_params.user) }
            },
            {
                label: 'view local data dir',
                click: () => {
                    MyOs.OpenDir(g_sys_params.local_data_dir);
                    SendInfoToWeb("already open dir: " + g_sys_params.local_data_dir);
                },
            },
            {
                label: 'open settings',
                click: OpenSettings,
            },
          ]
        },
        {
            label: 'Usage',
            click: () => { AlertToWeb(MyFile.SyncRead(path.join(__dirname, 'help/help.html'))); },
        },
        {
            label: 'About',
            submenu: [
                {
                    label: 'About',
                    // 向前台发送消息
                    click: () => { AlertToWeb(GetAboutText()); },
                },
                {
                    label: 'License',
                    // 向前台发送消息
                    click: () => { AlertToWeb(MyFile.SyncRead(path.join(__dirname, 'LICENSE'))); },
                }
            ]
        },
        {
            label: 'DevTools',
            click: () => { G_MAIN_WINDOW.webContents.openDevTools(); }
        },
    ])
}

function Init(){
    MyLog.Init(path.join(g_sys_params.local_data_dir, 'logs', 'app'), true);

    g_conf = new MyConf(path.join(g_sys_params.local_data_dir, g_sys_params.config_file_name));
    g_sys_params.db_file = path.join(g_sys_params.local_data_dir, g_sys_params.db_file_name);
    g_sys_params.user = g_conf.Get('user');
    g_sys_params.password = g_conf.Get('password');
    g_sys_params.repo_cache_dir = g_conf.GetOrSet('repo_cache_dir', path.join(g_sys_params.local_data_dir, 'repo_cache'));
    MyFile.MkDir(g_sys_params.repo_cache_dir);
    viewer_db.Init(g_sys_params.db_file);

    g_sys_params.tmp_dir = path.join(g_sys_params.local_data_dir, 'tmp');
    MyFile.RmDir(g_sys_params.tmp_dir);
    MyFile.MkDir(g_sys_params.tmp_dir);

    g_sys_params.ide_cmd = g_conf.GetOrSet('ide_cmd', '');

    //_GenEncrypPassword();
}

// 根据网卡、mac地址、CPU、内存型号等硬件信息生成加密密码
async function _GenEncrypPassword(){
    var hw_info = await si.get({
        networkInterfaces: 'mac,ip4',
        cpu: 'manufacturer,brand,speed,cores',
    });
    var hw_str = JSON.stringify(hw_info);
    var hw_hash = crypto.createHash('md5').update(hw_str).digest('hex');
    //console.log(hw_hash);
    g_sys_params.encryp_key = hw_hash;
}

G_MAIN_WINDOW = null

const createWindow = () => {
    // 设置icon路径，windows与arm版本路径不同
    if(is_windows){
        var icon_path = path.join(__dirname, 'res/img/repo-viewer.ico')
    }else if(process.platform == 'linux'){
        // 判断为linux，使用专用图标
        var icon_path = path.join(__dirname, 'res/img/repo-viewer.png')
    }else{
        var icon_path = path.join(__dirname, 'res/img/repo-viewer.png')
    }
    G_MAIN_WINDOW = new BrowserWindow({
      width: 1200,
      height: 800,
      backgroundColor: '#f0f0f0', // 设置窗口背景色,不生效
      icon: icon_path,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,      // 禁用node.js以使用jquery,为了安全也最好不要打开
        // contextIsolation这个值，在12.0.0以前默认值为false，后面为true，区别在于为true的话，注入的preload.js可视为一个独立运行的环境，对于渲染进程是不可见的
      },
    })

    // 退出前判断前端是否有修改
    G_MAIN_WINDOW.on('close', (e) => {
        // close 也会被quit触发，所以需要通过变量判断，此变量会在quit触发的before-quit事件中置为true.也就是实现quit才是真正退出
        G_CAN_APP_EXIST = true
        if (!G_CAN_APP_EXIST) {
            e.preventDefault()
        }
    })

    Init()

    // 创建菜单
    Menu.setApplicationMenu(CreateMenu())

    G_MAIN_WINDOW.loadFile('index.html')
}

// 窗口打开时
app.whenReady().then(() => {

    createWindow()
  
    // 兼容苹果,创建或从程序坞唤醒
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0){
            createWindow()
        }else{
            G_MAIN_WINDOW.show()
        }
    })

    // 处理未捕获异常
    process.on('uncaughtException', function (error) {
        SendErrorToWeb(error.message)
    })
    process.on('unhandledRejection', (reason, promise) => {
        SendErrorToWeb(reason.message)
    });

    // 监听渲染器到后台事件
    ipcMain.on('send-to-bgsys', HandleWebMsg)

    // TODO:remove this, 不知为何失效
    // G_MAIN_WINDOW.webContents.openDevTools();
})


app.on('activate', () => G_MAIN_WINDOW.show()) // mac点击程序坞显示窗口
app.on('before-quit', () => {
    G_CAN_APP_EXIST = true
})
// 应用关闭时
app.on('window-all-closed', () => {
    if (!is_mac) app.quit()  // mac放入程序坞，不关闭，其他平台直接关闭
})


// ==================================================== 发送消息给前台 ====================================================
// 发送事件给前台
function SendToWeb(name, data){
    if(G_MAIN_WINDOW){
        G_MAIN_WINDOW.webContents.send(name, data)
    }
}
// 后台异常通知前台，会弹框提示
function SendErrorToWeb(err_msg){
    console.log(MyDate.Now() + " send error msg to web: " + err_msg)
    SendToWeb('error-on-bg', err_msg)
}
// 发送普通消息给前台，只在界面下方展示
function SendInfoToWeb(msg){
    CallWeb('info-on-bg', msg)
}

// 前端弹框提示
function AlertToWeb(msg){
    CallWeb('modal-to-web', msg)
}

// 封装后的前后台通信组件，后续只需要在对方的handle方法中实现逻辑即可，省却preload的修改
function CallWeb(type, data=null){
    // TODO:remove this
    console.log(MyDate.Now() + " send to web: " + type + ' ' + JSON.stringify(data).substring(0, 3000))
    SendToWeb('send-to-web', {type:type, data:data})
}

// ==================================================== 逻辑功能函数 ====================================================
async function SetLastRepo(repo_url){
    // 保存最后访问的仓库到访问列表
    g_conf.Set('last_repo', repo_url)
    g_sys_params.cur_repo_viewer = new RepoViewer(repo_url, g_sys_params.user, 
        g_sys_params.password, os_type, g_sys_params.repo_cache_dir);
    if(await viewer_db.AddAccessedRepo(repo_url)){
        CallWeb('init-accessed-repo-list', await viewer_db.GetAccessedRepos());
    }
}
/**
 * 使用新的仓库地址刷新前端界面仓库树
 * @param {string} repo_url 仓库地址，如果不传则使用上次访问的仓库地址
 * @param {boolean} init_flag 是否为初始化标志，如果为true，则会进行一些初始化动作，如重置viewer实例并设置当前仓库查看器等
 */
async function RefreshRepoTree(repo_url=null, init_flag=false){
    if(g_sys_params.user && g_sys_params.password){
        if(!g_sys_params.cur_repo_viewer || init_flag){
            // 首次访问时设置仓库查看器
            if(!repo_url){
                var viewer_repo_url = g_conf.Get('last_repo')
            }else{
                var viewer_repo_url = repo_url;
            }
            g_sys_params.cur_repo_viewer = new RepoViewer(viewer_repo_url, g_sys_params.user, 
                g_sys_params.password, os_type, g_sys_params.repo_cache_dir);
        }
        // 如果repo_url包含版本号，需要去除，只有@符号后面没有/时才是版本号分隔符
        if (repo_url && repo_url.indexOf('@') > 0 && repo_url.indexOf('/', repo_url.indexOf('@')) === -1) {
            repo_url = repo_url.substring(0, repo_url.indexOf('@'));
        }
        let repo_tree = await g_sys_params.cur_repo_viewer.Api().GetRepoTree(repo_url);
        CallWeb('show-repo-tree', {url: repo_tree.url, tree: repo_tree});
        // 如果需要记录最后访问的仓库，则将其保存到后台
        if(init_flag && repo_url){
            SetLastRepo(g_sys_params.cur_repo_viewer.Api().GetRepoRoot(repo_url));
        }
        ShowCacheStatus();
    }
}

function ShowCacheStatus(){
    var cache_status = g_sys_params.cur_repo_viewer.Api().GetCacheStatus();
    if (cache_status){
        CallWeb('show-cache-status', cache_status);
    }
}

// ==================================================== 处理前台过来的消息 ====================================================
/**
 * 处理前端网页过来的消息
 * @param {*} event 
 * @param {*} msg 
 */
function HandleWebMsg(event, msg){
    let value = msg.data;
    try{
        console.debug(MyDate.Now() + " handle from web: " + msg.type + ' : ' + JSON.stringify(value).substring(0, 1000))

        var ProcessWebCall = {
            "close-app":function(v){
                // 收到前台检查后的退出消息，直接退出
                app.quit();
            },
            "set-password":function(v){
                g_conf.Set('user', v.user)
                g_conf.Set('password', v.password)
                g_sys_params.user = v.user
                g_sys_params.password = v.password
                SendInfoToWeb("save password ok");
            },
            "set-settings":function(v){
                // 保存设置
                for (const key in v) {
                    if (Object.hasOwnProperty.call(v, key)) {
                        g_conf.Set(key, v[key]);
                        g_sys_params[key] = v[key]; // 更新全局参数
                    }
                }
                SendInfoToWeb("save settings ok");
            },
            "save-repo-url":function(v){
                viewer_db.AddRepo(v.repo_url, v.nickname).then(() => {
                    CallWeb('save-repo-url-ok', v)
                })
            },
            "delete-saved-repo":function(v){
                viewer_db.DelRepo(v).then(() => {
                    CallWeb('delete-saved-repo-ok', v)
                })
            },
            "get-saved-repo-list":function(v){
                viewer_db.GetRepoList().then((data) => {
                    CallWeb('show-saved-repo-list', data)
                })
            },
            "init-accessed-repo-list":function(v){
                // 获取保存的仓库访问列表信息
                viewer_db.GetAccessedRepos().then((data) => {
                    CallWeb('init-accessed-repo-list', data)
                })
            },
            "edit-accessed-repo-list":async function(v){
                let all_acc_repos = await viewer_db.GetAccessedRepos();
                CallWeb('edit-accessed-repo-list', all_acc_repos);
            },
            "save-accessed-repo-list":function(v){
                viewer_db.SetAccessedRepos(v).then(() => {
                    // 触发界面accessed repo列表刷新
                    CallWeb('init-accessed-repo-list', v)
                })
            },
            "get-last-repo-tree":function(v){
                // 检查是否设置了密码，如果没有，提示设置密码
                if(!g_sys_params.user || ! g_sys_params.password){
                    CallWeb('open-password-panel')
                    return
                }
                RefreshRepoTree();
            },
            "get-repo-tree":function(v){
                // 初始化仓库数据
                if(!g_sys_params.user || ! g_sys_params.password){
                    CallWeb('open-password-panel')
                    return
                }
                RefreshRepoTree(v, true);
            },
            "get-repo-node":function(v){
                // 获取仓库节点
                RefreshRepoTree(v);
            },
            "set-last-repo":SetLastRepo,
            "get-repo-file":function(v){
                let api = g_sys_params.cur_repo_viewer.Api();
                let ide_cmd = g_sys_params.ide_cmd;
                // 使用vscode等打开文件
                if (api.GetCacheStatus()){
                    var local_path = api.GetLocalPath(v);
                    var local_repo_path = api.GetLocalRepoPath();
                    MyOs.OpenFileWithIde(local_path, local_repo_path, ide_cmd);
                }else{
                    let tmp_file = path.join(g_sys_params.tmp_dir, path.basename(v));
                    api.ExportRepoFile(v, tmp_file).then((data) => {
                        MyOs.OpenFileWithIde(tmp_file, g_sys_params.tmp_dir, ide_cmd);
                    })
                }
            },
            'open-repo-folder':function(v){
                var local_path = g_sys_params.cur_repo_viewer.Api().GetLocalPath(v);
                MyOs.OpenDir(local_path);
            },
            "get-repo-log":function(v){
                g_sys_params.cur_repo_viewer.Api().GetRepoLog(v).then((data) => {
                    CallWeb('show-repo-log', data)
                    ShowCacheStatus();
                })
            },
            "get-repo-properties":function(v){
                g_sys_params.cur_repo_viewer.Api().GetRepoProperty(v).then((data) => {
                    CallWeb('show-repo-properties', data)
                    ShowCacheStatus();
                })
            },
            'get-repo-file-diff':function(v){
                g_sys_params.cur_repo_viewer.Api().GetRepoFileDiff(v.path, v.begin, v.end).then((data) => {
                    CallWeb('show-repo-file-diff', data)
                    ShowCacheStatus();
                })
            },
            'get-repo-properties-diff':function(v){
                g_sys_params.cur_repo_viewer.Api().GetRepoPropertyDiff(v.path, v.begin, v.end).then((data) => {
                    CallWeb('show-repo-properties-diff', data)
                })
            },
            'refresh-repo':function(v){
                g_sys_params.cur_repo_viewer.Api().RefreshRepoTree(v);
                ShowCacheStatus();
            }
        }
        ProcessWebCall[msg.type](value);
    } catch (error) {
        SendErrorToWeb(error.message)
    }
}


function GetAboutText() {
    let txt = MyFile.SyncRead(path.join(__dirname, 'help/about.html'));
    let package = require("./package.json");
    return txt.replace('__version__', package.version).replace('__electron__', process.versions.electron).replace('__chromium__', process.versions.chrome).replace('__node__', process.versions.node);
}

function OpenSettings() {
    // 打开设置界面
    CallWeb('open-settings-panel', [{
        name: 'ide_cmd',
        desc: 'File Edit Command',
        value: g_sys_params.ide_cmd,
        help: 'Custom File Edit Command, for example, for VSCode: code -n "%%DIR_PATH%%" -- "%%FILE_PATH%%"',
    },
    {
        name: 'repo_cache_dir',
        desc: 'Repo Cache Directory',
        value: g_sys_params.repo_cache_dir,
        help: 'Directory to cache repository files, default is: ' + path.join(g_sys_params.local_data_dir, 'repo_cache'),
    },
    ]);
}