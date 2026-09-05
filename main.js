// 程序入口

const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process');
const fs = require('fs')
const path = require('path')
const RepoViewer = require('./module/repo_viewer')
const RepoSearch = require('./module/repo_search')
const ViewerDb = require('./module/viewer_db')
const MyConf = require('./util/my_conf')
const MyFile = require('./util/my_file')
const {MyDate, MyCheck} = require('./util/my_util')
const MyLog = require('./util/my_log')
const MyOs = require('./util/my_os')
const MyActionLog = require('./util/my_action_log')
const { MenuIcon } = require('./util/menu_icons')
const PasswordEncrypt = require('./util/password_encrypt')
const RepoUrl = require('./util/repo_url')

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
    credentials: {},   // 按主机:端口绑定的凭据内存态：{host:port: {user, password}}
    cur_repo_viewer: null,
    encryp_key: null,
    repo_cache_dir: "",
    ide_cmd: '',
}

var viewer_db = new ViewerDb();

// 调度器锁相关
const LOCK_HEARTBEAT_INTERVAL = 3600000;  // 心跳间隔一小时
const LOCK_STALE_TIMEOUT = 7200000;      // 锁超时2小时
var g_scheduler_lock = false;
var g_heartbeat_timer = null;

// 更新窗口标题，包含仓库信息
function UpdateWindowTitle(repo_name = null) {
    let base_title = "RepoViewer";
    let title = base_title;
    
    if (repo_name && repo_name.trim()) {
        // 提取仓库名称（去除.git后缀和URL路径）
        let clean_name = repo_name;
        if (clean_name.endsWith('.git')) {
            clean_name = clean_name.substring(0, clean_name.length - 4);
        }
        // 提取最后的仓库名
        let parts = clean_name.split('/');
        let repo_short_name = parts[parts.length - 1];
        title = `${repo_short_name} - ${base_title}`;
    }
    
    if (G_MAIN_WINDOW) {
        MyLog.logger.debug(`update window title: ${title}`);
        G_MAIN_WINDOW.setTitle(title);
    }
}

// 清除窗口标题中的仓库信息
function ClearWindowTitle() {
    if (G_MAIN_WINDOW) {
        G_MAIN_WINDOW.setTitle("RepoViewer");
    }
}

// 菜单详情
function CreateMenu(){
    return Menu.buildFromTemplate([
        {
          label: 'Data',
          submenu: [
            {
                label: 'open local data dir',
                icon: MenuIcon('dir'),
                click: () => {
                    MyOs.OpenDir(g_sys_params.local_data_dir);
                    SendInfoToWeb("already open dir: " + g_sys_params.local_data_dir);
                },
            },
            {
                label: 'open settings',
                icon: MenuIcon('gear'),
                click: OpenSettings,
            },
            {
                label:'set password',
                icon: MenuIcon('key'),
                click: () => {
                    var host = '';
                    var cred = null;
                    if (g_sys_params.cur_repo_viewer && g_sys_params.cur_repo_viewer.repo_url) {
                        host = RepoUrl.GetHostPort(g_sys_params.cur_repo_viewer.repo_url);
                        cred = host ? (g_sys_params.credentials[host] || null) : null;
                    }
                    CallWeb('open-password-panel', { host: host, user: cred ? cred.user : '', hasPwd: !!(cred && !MyCheck.IsEmpty(cred.password)) })
                },
            },
            {
                label: 'view action logs',
                icon: MenuIcon('list'),
                click: () => { CallWeb('show-action-logs', MyActionLog.GetLines(200)); },
            },
          ]
        },
        {
            label: 'Search',
            click: () => { CallWeb('open-all-repo-search'); }
        },
        {
            label: 'Usage',
            click: () => { AlertToWeb(MyFile.SyncRead(path.join(__dirname, 'help/help.html'))); },
        },
        {
            label: 'DevTools',
            click: () => { G_MAIN_WINDOW.webContents.openDevTools(); }
        },
        {
            label: 'About',
            submenu: [
                {
                    label: 'About',
                    icon: MenuIcon('info'),
                    // 向前台发送消息
                    click: () => { AlertToWeb(GetAboutText()); },
                },
                {
                    label: 'License',
                    icon: MenuIcon('doc'),
                    // 向前台发送消息
                    click: () => { AlertToWeb(MyFile.SyncRead(path.join(__dirname, 'LICENSE'))); },
                }
            ]
        },
    ])
}

// 查找数据库中第一个 svn 仓库对应的主机:端口，供旧全局凭据迁移使用
async function _FindFirstSvnHost() {
    var repos = await viewer_db.GetRepoList();
    for (var r of repos) {
        if (RepoUrl.GetRepoType(r.repo) === 'svn') {
            var host = RepoUrl.GetHostPort(r.repo);
            if (host) return host;
        }
    }
    return null;
}

// 按主机绑定的凭据在 sys.conf 中以 [cred@<host:port>] 节点存储
const CRED_NODE_PREFIX = 'cred@';

// 从 conf 读取全部按主机绑定的凭据（密文），返回 {host: {user, password, encrypt_type}}
function _getAllCredFromConf() {
    var root = g_conf.GetRoot();
    var out = {};
    for (var node in root) {
        if (node && node.indexOf(CRED_NODE_PREFIX) === 0) {
            var host = node.substring(CRED_NODE_PREFIX.length);
            var c = root[node];
            if (c) {
                out[host] = {
                    user: c.user || '',
                    password: c.password || '',
                    encrypt_type: c.encrypt_type || '',
                };
            }
        }
    }
    return out;
}

// 将凭据（密文）写入 conf 的对应主机节点
function _setCredToConf(host, user, password, encrypt_type) {
    var node = CRED_NODE_PREFIX + host;
    g_conf.Set('user', user, node);
    g_conf.Set('password', password, node);
    g_conf.Set('encrypt_type', encrypt_type, node);
}

async function Init(){
    MyLog.Init(path.join(g_sys_params.local_data_dir, 'logs', 'app'));

    g_conf = new MyConf(path.join(g_sys_params.local_data_dir, g_sys_params.config_file_name));
    g_sys_params.db_file = path.join(g_sys_params.local_data_dir, g_sys_params.db_file_name);

    // 旧版全局凭据（存于 sys.conf），仅用于一次性迁移到按主机绑定
    var legacyUser = g_conf.Get('user');
    var legacyPassword = g_conf.Get('password');
    var legacyEncryptType = g_conf.Get('encrypt_type');

    // 若旧全局凭据使用硬件指纹，需要在迁移/解密前生成密钥
    if (legacyEncryptType === 'hw_fingerprint') {
        g_sys_params.encryp_key = await PasswordEncrypt.genEncrypKey();
        MyLog.Info('[PasswordEncrypt] hw key generated for legacy credential migration');
    }

    // 初始化数据库
    await viewer_db.Init(g_sys_params.db_file);

    // 读取当前已按主机绑定的凭据（存于 conf）
    var credentialStore = _getAllCredFromConf();

    // 迁移旧全局凭据到数据库第一个 svn 仓库对应的主机
    if (legacyUser && Object.keys(credentialStore).length === 0) {
        var targetHost = await _FindFirstSvnHost();
        if (targetHost) {
            _setCredToConf(targetHost, legacyUser, legacyPassword || '', legacyEncryptType || '');
            MyLog.Info(`legacy global credential migrated to host: ${targetHost}`);
            credentialStore = _getAllCredFromConf();
        } else {
            MyLog.Warn('no svn repo found, legacy global credential dropped (not migrated)');
        }
    }
    // 只要检测到旧全局凭据，就彻底删除，避免残留和重复迁移（即使已有新凭据或迁移失败）
    if (legacyUser) {
        g_conf.Delete('user');
        g_conf.Delete('password');
        g_conf.Delete('encrypt_type');
        MyLog.Info('legacy global credential (user/password) removed from sys.conf');
    }

    // 解密并加载全部按主机绑定的凭据到内存
    g_sys_params.credentials = {};
    if (credentialStore) {
        // 若存在按主机保存的硬件指纹凭据且尚未生成密钥，需先生成以便解密
        if (!g_sys_params.encryp_key) {
            for (var hfp in credentialStore) {
                var hfpCred = credentialStore[hfp];
                if (hfpCred && hfpCred.encrypt_type === 'hw_fingerprint') {
                    g_sys_params.encryp_key = await PasswordEncrypt.genEncrypKey();
                    MyLog.Info('[PasswordEncrypt] hw key generated for stored hw_fingerprint credentials');
                    break;
                }
            }
        }
        for (var host in credentialStore) {
            var c = credentialStore[host];
            if (!c) continue;
            var pwd = c.password || '';
            if (pwd && (c.encrypt_type === 'safe_storage' || c.encrypt_type === 'hw_fingerprint')) {
                try {
                    var dec = PasswordEncrypt.decrypt(pwd, c.encrypt_type, g_sys_params.encryp_key);
                    pwd = (dec !== null) ? dec : '';
                } catch (e) {
                    MyLog.Warn(`credential decrypt failed for ${host}: ${e.message}`);
                    pwd = '';
                }
            }
            g_sys_params.credentials[host] = { user: c.user || '', password: pwd };
        }
    }

    g_sys_params.repo_cache_dir = g_conf.GetOrSet('repo_cache_dir', path.join(g_sys_params.local_data_dir, 'repo_cache'));
    MyFile.MkDir(g_sys_params.repo_cache_dir);

    g_sys_params.tmp_dir = path.join(g_sys_params.local_data_dir, 'tmp');
    MyFile.RmDir(g_sys_params.tmp_dir);
    MyFile.MkDir(g_sys_params.tmp_dir);

    g_sys_params.ide_cmd = g_conf.GetOrSet('ide_cmd', '');
    g_sys_params.daily_update_time = g_conf.GetOrSet('daily_update_time', '06:00');
    g_sys_params.daily_update_count = parseInt(g_conf.GetOrSet('daily_update_count', 6), 10);

    MyActionLog.Init(path.join(g_sys_params.local_data_dir, 'logs'));
}

G_MAIN_WINDOW = null

const createWindow = async () => {
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
      backgroundColor: '#ffffff', // 窗口背景色，与 body 背景一致
      icon: icon_path,
      title: "RepoViewer", // 设置默认窗口标题
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

    await Init()

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
        SendErrorToWeb(error)
    })
    process.on('unhandledRejection', (reason, promise) => {
        SendErrorToWeb(reason)
    });

    // 监听渲染器到后台事件
    ipcMain.on('send-to-bgsys', HandleWebMsg)

    // 启动后台定时任务
    _InitScheduler();

    // TODO:remove this, 不知为何失效
    // G_MAIN_WINDOW.webContents.openDevTools();
})


app.on('activate', () => G_MAIN_WINDOW.show()) // mac点击程序坞显示窗口
app.on('before-quit', () => {
    G_CAN_APP_EXIST = true
    if (g_heartbeat_timer) {
        clearInterval(g_heartbeat_timer);
        g_heartbeat_timer = null;
    }
    _ReleaseLock();
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
function ErrorMsg(err){
    if (typeof err === 'string') return err;
    if (err == null) return '未知错误';
    return err.message || err.stack || JSON.stringify(err) || '未知错误';
}
function SendErrorToWeb(err_msg){
    const msg = ErrorMsg(err_msg);
    console.log(MyDate.Now() + " send error msg to web: " + msg)
    SendToWeb('error-on-bg', msg)
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
async function SetLastRepo(repo_root){
    // 保存最后访问的仓库到访问列表
    g_conf.Set('last_repo', repo_root)
    // 注意此处的repo_url不包含版本号
    if(await viewer_db.AddAccessedRepo(repo_root)){
        CallWeb('init-accessed-repo-list', await viewer_db.GetAccessedRepos());
    }
    // 记录仓库访问时间用于频率统计
    await viewer_db.AddRepoAccessRecord(repo_root);
    // 更新窗口标题显示当前仓库
    UpdateWindowTitle(repo_root);
}
/**
 * 使用新的仓库地址刷新前端界面仓库树,更新树或者树节点都会访问此函数
 * @param {string} repo_url 仓库地址，如果不传则使用上次访问的仓库地址
 * @param {boolean} init_flag 是否为初始化标志，如果为true，则会进行一些初始化动作，如重置viewer实例并设置当前仓库查看器等
 */
async function RefreshRepoTree(repo_url=null, init_flag=false, force=false){
    let first_access = false;
    var viewer_repo_url = repo_url || g_conf.Get('last_repo');
    var host = RepoUrl.GetHostPort(viewer_repo_url);
    var cred = host ? (g_sys_params.credentials[host] || null) : null;
    if (!cred) {
        // 该主机尚未配置凭据：弹出登录框；若留空（用户/密码都为空），保存后按匿名访问
        CallWeb('open-password-panel', { host: host || '', user: '', hasPwd: false });
        return;
    }
    if(!g_sys_params.cur_repo_viewer || init_flag){
        // 首次访问时设置仓库查看器
        first_access = true;
        g_sys_params.cur_repo_viewer = new RepoViewer(viewer_repo_url, cred.user,
            cred.password, os_type, g_sys_params.repo_cache_dir);
    }
    // 如果repo_url包含版本号，需要去除，只有@符号后面没有/时才是版本号分隔符
    if (repo_url && repo_url.indexOf('@') > 0 && repo_url.indexOf('/', repo_url.indexOf('@')) === -1) {
        // 如果包含版本需要去除，版本号已经初始化在了api对象中，无需此处传入
        repo_url = repo_url.substring(0, repo_url.indexOf('@'));
    }
    let repo_tree = await g_sys_params.cur_repo_viewer.Api().GetRepoTree(repo_url, force);
    CallWeb('show-repo-tree', {url: repo_tree.url, tree: repo_tree});
    
    // 更新窗口标题，显示当前仓库信息
    let repo_root = g_sys_params.cur_repo_viewer.Api().GetRepoRoot(repo_tree.url);
    
    // 如果需要记录最后访问的仓库，则将其保存到后台
    if(init_flag && repo_url){
        // 更换仓库时，需要更新最后访问的仓库地址
        SetLastRepo(repo_root);
    }else if(first_access){
        UpdateWindowTitle(repo_root);
    }
    ShowCacheStatus();
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
        // 对敏感消息脱敏后再日志
        var logValue = (msg.type === 'set-password' && value) ? { ...value, password: '****' } : value;
        console.debug(MyDate.Now() + " handle from web: " + msg.type + ' : ' + JSON.stringify(logValue).substring(0, 1000))

        var ProcessWebCall = {
            "close-app":function(v){
                // 收到前台检查后的退出消息，直接退出
                app.quit();
            },
            "set-password":async function(v){
                var host = v.host;
                if (!host) {
                    SendInfoToWeb("please input host for credential");
                    return;
                }
                // 从 conf 读取该主机已有凭据（密文）
                var credStore = _getAllCredFromConf();
                var current = credStore[host] || {};
                current.user = v.user;
                if(v.password !== undefined){
                    if (v.password === '') {
                        // 空密码：清空存储，encrypt_type 也清除
                        current.password = '';
                        current.encrypt_type = '';
                    } else {
                        // 如果 safeStorage 不可用且尚无硬件密钥，现场生成
                        if (!PasswordEncrypt.isSafeStorageAvailable() && !g_sys_params.encryp_key) {
                            MyLog.Info('[PasswordEncrypt] generating hw key for save (safeStorage unavailable)');
                            g_sys_params.encryp_key = await PasswordEncrypt.genEncrypKey();
                        }
                        var result = PasswordEncrypt.encrypt(v.password, g_sys_params.encryp_key);
                        current.password = result.encrypted;
                        current.encrypt_type = result.encryptType;
                    }
                }
                _setCredToConf(host, current.user, current.password, current.encrypt_type);
                // 更新内存态（明文），供当前会话使用
                var pwdMem = g_sys_params.credentials[host] ? g_sys_params.credentials[host].password : '';
                if (v.password === undefined) {
                    // 未修改密码，保留原有明文
                } else if (v.password === '') {
                    pwdMem = '';
                } else {
                    pwdMem = v.password;
                }
                g_sys_params.credentials[host] = { user: v.user, password: pwdMem };
                SendInfoToWeb("save password ok (" + host + ")");
                // 保存成功后，若待访问的正是该主机的仓库，则自动重新加载目录树
                var lastRepo = g_conf.Get('last_repo');
                if (lastRepo && RepoUrl.GetHostPort(lastRepo) === host) {
                    RefreshRepoTree();
                }
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
            "get-recent-repos":function(v){
                // 获取最近访问的仓库列表
                viewer_db.GetRecentAccessedRepos(15).then((data) => {
                    CallWeb('show-recent-repos', data)
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
                // 凭据缺失时 RefreshRepoTree 内部会弹登录框
                RefreshRepoTree();
            },
            "get-repo-tree":function(v){
                // 初始化仓库数据，凭据缺失时 RefreshRepoTree 内部会弹登录框
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
            "get-more-repo-log":function(v){
                g_sys_params.cur_repo_viewer.Api().GetRepoLog(v.path, null, v.from_revision).then((data) => {
                    CallWeb('show-more-repo-log', data)
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
                g_sys_params.cur_repo_viewer.Api().GetRepoFileDiff(v.path, v.begin, v.end, v.copy_src).then((data) => {
                    CallWeb('show-repo-file-diff', data)
                    ShowCacheStatus();
                })
            },
            'get-repo-properties-diff':function(v){
                g_sys_params.cur_repo_viewer.Api().GetRepoPropertyDiff(v.path, v.begin, v.end).then((data) => {
                    CallWeb('show-repo-properties-diff', data)
                })
            },
            // ==================== 分支比对 ====================
            'get-branch-list':async function(v){
                var api = g_sys_params.cur_repo_viewer.Api();
                try{
                    var data = await api.GetBranchList(v);
                    CallWeb('show-branch-list', data);
                }catch(e){
                    SendErrorToWeb('获取分支列表失败: ' + (e?.message || String(e)));
                }
            },
            'compare-branch':async function(v){
                var api = g_sys_params.cur_repo_viewer.Api();
                try{
                    var data = await api.CompareBranches(v.baseRoot, v.targetUrl, v.mode || 'base');
                    CallWeb('show-branch-compare', data);
                }catch(e){
                    SendErrorToWeb('分支比对失败: ' + (e?.message || String(e)));
                }
            },
            'compare-branch-file':async function(v){
                var api = g_sys_params.cur_repo_viewer.Api();
                try{
                    var data = await api.GetBranchFileDiff(v.baseUrl, v.targetUrl);
                    CallWeb('show-branch-file-diff', data);
                }catch(e){
                    SendErrorToWeb('查看文件差异失败: ' + (e?.message || String(e)));
                }
            },
            'refresh-repo':function(v){
                g_sys_params.cur_repo_viewer.Api().RefreshRepoTree(v);
                ShowCacheStatus();
            },
            'manual-batch-update':async function(v){
                // 手动触发批量更新（在操作日志界面点击按钮触发）
                MyLog.Info('Manual batch update triggered by user from action logs');
                MyActionLog.Add('Manual batch update triggered by user from action logs', 'info');
                await RunDailyUpdate();
                // 更新完成后发送最新日志给前端刷新界面
                CallWeb('batch-update-completed', MyActionLog.GetLines(200));
            },
            'get-action-logs':function(v){
                CallWeb('show-action-logs', MyActionLog.GetLines(v || 200));
            },
            // ==================== 仓库文件搜索 ====================
            'check-svn-cache':function(v){
                try {
                    var api = g_sys_params.cur_repo_viewer.Api();
                    var status = api.GetCacheStatus(v ? v.searchPath : null);
                    // 计算项目根（用于前端 checkout 提示） 
                    var projectRoot = '';
                    if (v && v.searchPath) {
                        projectRoot = api.GetRepoRoot(v.searchPath);
                    }
                    CallWeb('svn-cache-status', {
                        cached: !!status,
                        local_path: status ? status.local_path : '',
                        projectRoot: projectRoot,
                    });
                } catch (e) {
                    CallWeb('svn-cache-status', {cached: false, local_path: ''});
                }
            },
            'checkout-svn-repo':async function(v){
                // 用户确认后确保 SVN 仓库本地就绪（checkout 或 update）
                // v.searchPath 为搜索路径，用于确定正确的分支 URL
                var api = g_sys_params.cur_repo_viewer.Api();
                try {
                    CallWeb('info-on-bg', '正在准备 SVN 本地副本...');
                    var targetUrl = api._ExtractBranchRootFromUrl(v ? v.searchPath : null);
                    await api.EnsureRepoReady(targetUrl);
                    CallWeb('info-on-bg', 'SVN 本地副本就绪');
                    CallWeb('svn-cache-status', {cached: true, local_path: ''});
                } catch (e) {
                    SendErrorToWeb('SVN 准备失败: ' + (e?.message || String(e)));
                    CallWeb('svn-checkout-failed', {error: e?.message || String(e)});
                }
            },
            'search-repo-files':async function(v){
                // 搜索仓库文件
                // v: {path, pattern, isRegex}
                var api = g_sys_params.cur_repo_viewer.Api();
                var pattern = RepoSearch.BuildPattern(v.pattern, v.isRegex);

                if (!pattern) {
                    CallWeb('show-search-results', {matched: [], error: '搜索模式无效'});
                    return;
                }

                try {
                    var result = await api.SearchFiles(v.path, pattern);
                    CallWeb('show-search-results', result);
                } catch (e) {
                    MyLog.Error('search error: ' + (e?.message || String(e)));
                    CallWeb('show-search-results', {matched: [], error: '搜索失败: ' + (e?.message || String(e))});
                }
            },
            // ==================== 跨仓库搜索 ====================
            'search-all-repos':function(v){
                // 搜索所有已缓存仓库的文件
                // v: {pattern, isRegex}
                var pattern = RepoSearch.BuildPattern(v.pattern, v.isRegex);
                if (!pattern) {
                    CallWeb('show-all-repo-search-results', {matched: [], error: '搜索模式无效', stats: {scanned: 0, found: 0, errors: []}});
                    return;
                }

                MyLog.Info('start search all cached repos, pattern: ' + pattern);
                var result = RepoSearch.SearchCachedRepos(g_sys_params.repo_cache_dir, pattern);
                MyLog.Info('search all cached repos done, scanned: ' + result.stats.scanned + ', found: ' + result.stats.found);
                CallWeb('show-all-repo-search-results', result);
            },
        }
        ProcessWebCall[msg.type](value);
    } catch (error) {
        SendErrorToWeb(error)
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
    {
        name: 'daily_update_time',
        desc: 'Daily Update Time',
        value: g_sys_params.daily_update_time,
        help: 'Daily auto update time, format HH:mm (24-hour), default: 06:00',
    },
    {
        name: 'daily_update_count',
        desc: 'Daily Update Count',
        value: g_sys_params.daily_update_count,
        help: 'Number of frequently used repos to update daily, default: 6',
    },
    ]);
}

// ==================================================== 后台定时任务 ====================================================

async function RunDailyUpdate() {
    // 锁检查：只有持有调度器锁的实例才执行更新
    if (!g_scheduler_lock) {
        if (_TryAcquireLock()) {
            g_scheduler_lock = true;
            g_heartbeat_timer = setInterval(_UpdateHeartbeat, LOCK_HEARTBEAT_INTERVAL);
            MyLog.Info('This instance took over scheduler lock');
            MyActionLog.Add('This instance took over scheduler lock', 'info');
        } else {
            MyLog.Info('Skipping daily update: scheduler lock held by another instance');
            return;
        }
    }

    _UpdateHeartbeat();

    if (!g_sys_params.credentials || Object.keys(g_sys_params.credentials).length === 0) {
        MyLog.Info('Daily update skipped: no credentials configured');
        return;
    }

    // 清理过期的访问记录
    await viewer_db.CleanupRepoAccess();

    const taskId = `daily-${Date.now()}`;
    const taskStartTime = Date.now();

    try {
        const repoCount = g_sys_params.daily_update_count > 0 ? g_sys_params.daily_update_count : 6;
        const repos = await viewer_db.GetFrequentlyUsedRepos(15, repoCount, 'git');
        if (repos.length === 0) {
            const msg = `[${taskId}] No repos with access records found, skipping update`;
            MyLog.Info(msg);
            MyActionLog.Add(msg, 'info');
            SendInfoToWeb(msg);
            return;
        }

        MyLog.Info(`[${taskId}] Starting daily repo update task: ${repos.length} repos to update`);
        SendInfoToWeb(`[${MyDate.GetTime4Str(new Date())}] Starting daily update: ${repos.length} repos...`);
        MyActionLog.Add(`[${taskId}] Starting daily repo update: ${repos.length} repos to update`, 'info');

        let successCount = 0;
        let failCount = 0;

        for (const repo_url of repos) {
            const host = RepoUrl.GetHostPort(repo_url);
            const cred = host ? (g_sys_params.credentials[host] || null) : null;
            if (!cred) {
                const skipMsg = `[${taskId}] Skip repo (no credential for ${host}): ${repo_url}`;
                MyLog.Info(skipMsg);
                MyActionLog.Add(skipMsg, 'info');
                continue;
            }
            try {
                const repoStartTime = Date.now();
                const repoStartStr = MyDate.GetTime4Str(new Date(repoStartTime));
                MyLog.Info(`[${taskId}] Updating repo: ${repo_url}`);
                SendInfoToWeb(`[${repoStartStr}] Updating repo: ${repo_url}`);

                const viewer = new RepoViewer(repo_url, cred.user, cred.password, os_type, g_sys_params.repo_cache_dir);
                await viewer.Api().GetRepoTree(repo_url, true); // force=true 强制刷新缓存

                const repoElapsed = Date.now() - repoStartTime;
                const repoElapsedStr = repoElapsed >= 1000 ? `${(repoElapsed / 1000).toFixed(1)}s` : `${repoElapsed}ms`;
                successCount++;
                MyActionLog.Add(`[${taskId}] Updated repo: ${repo_url} (cost: ${repoElapsedStr})`, 'info');
                MyLog.Info(`[${taskId}] Successfully updated repo: ${repo_url} (cost: ${repoElapsedStr})`);
                SendInfoToWeb(`[${MyDate.GetTime4Str(new Date())}] Updated repo: ${repo_url} (cost: ${repoElapsedStr})`);
            } catch (e) {
                failCount++;
                const errMsg = `[${taskId}] Failed to update repo: ${repo_url}, error: ${e.message}`;
                MyLog.Error(errMsg);
                MyActionLog.Add(errMsg, 'error');
                SendInfoToWeb(errMsg);
            }
        }

        const totalElapsed = Date.now() - (taskStartTime || Date.now());
        const totalElapsedStr = totalElapsed >= 1000 ? `${(totalElapsed / 1000).toFixed(1)}s` : `${totalElapsed}ms`;
        const completeMsg = `[${taskId}] Daily repo update completed: total ${repos.length}, success ${successCount}, failed ${failCount} (cost: ${totalElapsedStr})`;
        MyLog.Info(completeMsg);
        MyActionLog.Add(completeMsg, 'info');
        SendInfoToWeb(completeMsg);
    } catch (e) {
        const errMsg = `[${taskId}] Daily update error: ${e.message}`;
        MyLog.Error(errMsg);
        MyActionLog.Add(errMsg, 'error');
        SendInfoToWeb(errMsg);
    }
}

function ScheduleDailyUpdate() {
    const parts = (g_sys_params.daily_update_time || '06:00').split(':');
    const hour = parseInt(parts[0], 10) || 6;
    const minute = parseInt(parts[1], 10) || 0;

    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
        next.setDate(next.getDate() + 1);
    }
    const msUntilNext = next - now;

    var nextTimeStr = MyDate.GetDateStr(next, true);
    MyLog.Info(`Daily update check scheduled, next run at ${nextTimeStr}`);
    MyActionLog.Add(`Daily update check scheduled, next run at ${nextTimeStr}`, 'info');

    setTimeout(() => {
        RunDailyUpdate().then(() => {
            setInterval(RunDailyUpdate, 24 * 60 * 60 * 1000);
        });
    }, msUntilNext);
}

// ==================================================== 调度器锁管理 ====================================================

function _LockFilePath() {
    return path.join(g_sys_params.local_data_dir, 'scheduler.lock');
}

/**
 * 原子写入锁文件：先写临时文件，再 rename 覆盖，防止写入过程中崩溃导致锁文件损坏
 */
function _AtomicWriteLock(data) {
    const lockFile = _LockFilePath();
    const tmpFile = lockFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf-8');
    // 重命名（原子操作）
    try {
        fs.renameSync(tmpFile, lockFile);
    } catch (e) {
        // rename 失败时尝试直接覆盖（如跨分区问题）
        fs.copyFileSync(tmpFile, lockFile);
        fs.unlinkSync(tmpFile);
    }
}

/**
 * 读取并解析锁文件，解析失败时返回 null
 */
function _ReadLockFile() {
    const lockFile = _LockFilePath();
    if (!fs.existsSync(lockFile)) return null;
    const content = fs.readFileSync(lockFile, 'utf-8');
    if (!content) return null;
    try {
        return JSON.parse(content);
    } catch (e) {
        MyLog.Warn(`Corrupted lock file (${e.message}), treating as stale`);
        return null;
    }
}

/**
 * 检查 pid 对应的进程是否仍然存活
 * process.kill(pid, 0) 在跨平台下可用于检测进程存在性
 */
function _IsPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // ESRCH: no such process, EPERM: exists but no permission (仍存活)
        return e.code === 'EPERM';
    }
}

function _TryAcquireLock() {
    try {
        const data = _ReadLockFile();
        if (data) {
            // 先检查 pid 对应的进程是否还活着
            if (data.pid && _IsPidAlive(data.pid)) {
                const elapsed = Date.now() - (data.heartbeat || 0);
                if (elapsed < LOCK_STALE_TIMEOUT) {
                    MyLog.Info(`Scheduler lock held by another instance (pid ${data.pid}, heartbeat ${elapsed}ms ago)`);
                    return false;
                }
                MyLog.Warn(`Found stale scheduler lock (pid ${data.pid}, ${elapsed}ms stale, process alive but heartbeat expired), taking over`);
            } else {
                MyLog.Warn(`Found stale scheduler lock (pid ${data.pid} dead), taking over`);
            }
        } else if (fs.existsSync(_LockFilePath())) {
            MyLog.Warn('Found corrupted lock file, overwriting');
        }
        _AtomicWriteLock({ pid: process.pid, heartbeat: Date.now() });
        return true;
    } catch (e) {
        MyLog.Warn(`Failed to acquire scheduler lock: ${e && e.message ? e.message : e}`);
        return false;
    }
}

function _ReleaseLock() {
    try {
        const data = _ReadLockFile();
        if (data && data.pid === process.pid) {
            fs.unlinkSync(_LockFilePath());
        }
    } catch (e) {}
}

function _UpdateHeartbeat() {
    if (!g_scheduler_lock) return;
    try {
        var data = _ReadLockFile();
        if (!data) {
            // 锁文件缺失或损坏，重新创建
            MyLog.Warn('Lock file missing or corrupted during heartbeat, re-creating');
            data = { pid: process.pid, heartbeat: Date.now() };
        } else {
            data.heartbeat = Date.now();
        }
        _AtomicWriteLock(data);
    } catch (e) {}
}

function _InitScheduler() {
    if (_TryAcquireLock()) {
        g_scheduler_lock = true;
        MyLog.Info('This instance acquired scheduler lock');
        MyActionLog.Add('This instance acquired scheduler lock and will manage daily updates', 'info');
        g_heartbeat_timer = setInterval(_UpdateHeartbeat, LOCK_HEARTBEAT_INTERVAL);
    } else {
        MyLog.Info('Scheduler lock held by another instance, will check again at run time');
        MyActionLog.Add('Scheduler lock held by another instance, will check again at run time', 'info');
    }
    ScheduleDailyUpdate();
}