const https = require('https'); 
const Buffer = require('buffer').Buffer; // 如果使用 Node.js v12+，需要引入 Buffer 模块 
const XmlParser = require('fast-xml-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {MyDate, MyUnit, MyCheck} = require('../util/my_util')
const MyLog = require('../util/my_log')
const MyFile = require('../util/my_file');

/**
 * 通过svn命令行工具获取SVN远程仓库的信息，需要确保主机上已经安装svn客户端
 *
 * ─── 两个"根"的概念 ───
 *
 * 仓库根 (Repo Root)：
 *   SVN 服务器上的真实仓库根，由 URL 中 /svn/ 后第一级目录决定。
 *   例如 URL = "http://xlsvn:8888/svn/myapps/easyviptool/trunk"
 *   → 仓库根 = "http://xlsvn:8888/svn/myapps"
 *   由 GetRepoTree() 设置在 this.repo_root 上，用于树结构浏览。
 *
 * 项目根 (Project Root)：
 *   用户视角的逻辑项目根，即 trunk/branches/tags 的上一级目录。
 *   例如 URL = "http://xlsvn:8888/svn/myapps/easyviptool/trunk"
 *   → 项目根 = "http://xlsvn:8888/svn/myapps/easyviptool"
 *   由 GetRepoRoot(url) 方法返回，用于缓存 key 和路径计算。
 *
 * 缓存以项目根为 key 存储在 this._cacheMap 中：
 *   projectRoot → { cacheDir, hash }
 *   同一项目的 trunk 和不同 branches 共享同一缓存目录（通过 svn switch 切换内容）。
 */
class SvnCommandApi{
    constructor(repo_url, user, password, os_type, cache_root_dir = null) {
        // 如果repo_url指定svn版本则拆解为url和版本号
        var idx = repo_url.indexOf('@');
        if(idx !== -1){
            this.repo_url = repo_url.substring(0, idx);
            this.svn_version = `@${repo_url.substring(idx + 1)}`;
        }else{
            this.repo_url = repo_url;
            this.svn_version = null;
        }
        this.repo_root = null;   // 仓库根目录，真实repo，非逻辑repo
        this.server_root = null;  // 服务器根目录，即/svn/之前的部分
        this.user = user;
        this.password = password;

        this.os_type = os_type;
        this.cache_root_dir = cache_root_dir;  // 仅保存，不 InitCache
        this._cacheMap = {};   // projectRoot → { cacheDir, hash }
        this._branchDiffCache = {};   // `${base}|${target}` → { time, data }，短期缓存分支比对摘要，避免切换目标分支时重复远程全树diff
        this._forkRevCache = {};   // baseBranchUrl → 拉分支时版本（copy版本），分支创建后固定，跨会话缓存

        MyLog.Info(`svn command api init, repo: ${repo_url}, fixed_version: ${this.svn_version}, os type:${this.os_type}`);
    }

    /**
     * 获取缓存状态
     * @param {string} [searchPath] - 搜索路径，用于检查指定项目根是否有缓存
     * @returns {object|null}
     */
    GetCacheStatus(searchPath){
        // 有搜索路径时，按项目根精确查找
        if (searchPath) {
            const projectRoot = this.GetRepoRoot(searchPath);
            // 1. 查 _cacheMap 对照表
            if (this._cacheMap[projectRoot]) {
                return { local_path: '', br_name: '', up_time: '' };
            }
            // 2. 查磁盘上对应项目根的缓存目录
            if (this.cache_root_dir) {
                const cacheDir = this._GetCacheDir(projectRoot);
                if (cacheDir && fs.existsSync(path.join(cacheDir, '.svn'))) {
                    // 磁盘上有缓存，记录到 _cacheMap 供后续使用
                    this._cacheMap[projectRoot] = {
                        cacheDir,
                        hash: crypto.createHash('md5').update(projectRoot).digest('hex')
                    };
                    return { local_path: '', br_name: '', up_time: '' };
                }
            }
            return null;
        }

        // 无搜索路径：检查 _cacheMap 是否有任意条目（向后兼容）
        for (var key in this._cacheMap) {
            if (this._cacheMap.hasOwnProperty(key)) {
                return { local_path: '', br_name: '', up_time: '' };
            }
        }
        return null;
    }

    /**
     * 获取项目根对应的缓存目录路径
     * @param {string} projectRoot - 项目根 URL
     * @returns {string|null}
     */
    _GetCacheDir(projectRoot) {
        if (!this.cache_root_dir || !projectRoot) return null;
        const hash = crypto.createHash('md5').update(projectRoot).digest('hex');
        return path.join(this.cache_root_dir, hash + '.svn');
    }

    /**
     * 获取或创建项目根对应的缓存条目（见类注释"两个根的概念"）
     * @param {string} projectRoot - 项目根 URL（GetRepoRoot 返回值）
     * @returns {{ cacheDir: string, hash: string }|null}
     */
    _GetCacheEntry(projectRoot) {
        if (!this.cache_root_dir || !projectRoot) return null;
        if (this._cacheMap[projectRoot]) return this._cacheMap[projectRoot];

        const cacheDir = this._GetCacheDir(projectRoot);
        if (!cacheDir) return null;
        MyFile.MkDir(cacheDir);

        const hash = crypto.createHash('md5').update(projectRoot).digest('hex');
        const entry = { cacheDir, hash };
        this._cacheMap[projectRoot] = entry;
        return entry;
    }

    /**
     * 获取项目根 URL（parent of trunk/branches/tags）
     */
    GetRepoRootUrl() {
        return this.GetRepoRoot(this.repo_url);
    }

    /**
     * 获取分支级 URL（trunk 或 branches/xxx 或 tags/xxx），基于实例的 repo_url
     */
    _GetBranchRootUrl() {
        const rootUrl = this.GetRepoRoot(this.repo_url);
        const remaining = this.repo_url.substring(rootUrl.length);
        const parts = remaining.replace(/^\//, '').split('/');
        if (parts.length >= 1) {
            if (parts[0] === 'trunk') {
                return rootUrl + '/trunk';
            }
            if ((parts[0] === 'branches' || parts[0] === 'tags') && parts.length >= 2) {
                return rootUrl + '/' + parts[0] + '/' + parts[1];
            }
        }
        return this.repo_url;
    }

    /**
     * 从任意 URL 中提取分支级路径（trunk 或 branches/xxx 或 tags/xxx）
     */
    _ExtractBranchRootFromUrl(searchUrl) {
        if (!searchUrl) return this._GetBranchRootUrl();
        const rootUrl = this.GetRepoRoot(searchUrl);
        const remaining = searchUrl.substring(rootUrl.length);
        const parts = remaining.replace(/^\//, '').split('/');

        if (parts.length >= 1) {
            if (parts[0] === 'trunk') {
                return rootUrl + '/trunk';
            }
            if ((parts[0] === 'branches' || parts[0] === 'tags') && parts.length >= 2) {
                return rootUrl + '/' + parts[0] + '/' + parts[1];
            }
        }
        return this._GetBranchRootUrl();
    }

    /**
     * 确保本地副本就绪：未 checkout 则 checkout，已存在则按需 update 或 switch
     * 缓存信息从 _cacheMap 对照表获取
     * @param {string|null} targetUrl - 目标 checkout URL
     */
    async EnsureRepoReady(targetUrl = null) {
        const checkoutUrl = targetUrl || this._GetBranchRootUrl();
        const projectRoot = this.GetRepoRoot(checkoutUrl);
        const cacheEntry = this._GetCacheEntry(projectRoot);
        if (!cacheEntry) return;

        const localPath = cacheEntry.cacheDir;
        const hasWorkingCopy = fs.existsSync(path.join(localPath, '.svn'));
        if (!hasWorkingCopy) {
            await this._CheckoutRepo(checkoutUrl, localPath, projectRoot);
        } else {
            const currentUrl = await this._GetWorkingCopyUrl(localPath);
            if (currentUrl && currentUrl !== checkoutUrl) {
                MyLog.Info(`svn switch: ${currentUrl} -> ${checkoutUrl}`);
                await this._GetSvnCommandResult(`switch "${checkoutUrl}" "${localPath}"`).catch(SvnCommandApi._ProcessCommandError);
                this._SaveLastUpdateTime(projectRoot);
                this._SaveRepoInfo(projectRoot);
            } else {
                await this._UpdateRepo(localPath, projectRoot);
            }
        }
    }

    /**
     * 获取工作副本 URL
     * @param {string} localPath - 工作副本路径
     */
    async _GetWorkingCopyUrl(localPath) {
        try {
            const res = await this._GetSvnCommandResult(`info --show-item url "${localPath}"`);
            if (res) return res.trim();
        } catch (e) {
            MyLog.Debug(`svn info failed, fallback to entries: ${e.message}`);
        }
        const entriesPath = path.join(localPath, '.svn', 'entries');
        if (fs.existsSync(entriesPath)) {
            try {
                const content = fs.readFileSync(entriesPath, 'utf8');
                const lines = content.split('\n');
                if (lines.length > 0 && lines[0].trim()) {
                    return lines[0].trim();
                }
            } catch (e) {
                MyLog.Debug(`read svn entries failed: ${e.message}`);
            }
        }
        return null;
    }

    /**
     * Checkout 指定 URL 到本地缓存
     * @param {string} url - checkout 目标 URL
     * @param {string} localPath - 本地路径
     * @param {string} projectRoot - 项目根 URL
     */
    async _CheckoutRepo(url, localPath, projectRoot) {
        MyLog.Info(`svn checkout: ${url} -> ${localPath}`);
        await this._GetSvnCommandResult(`checkout "${url}" "${localPath}"`).catch(SvnCommandApi._ProcessCommandError);
        this._SaveLastUpdateTime(projectRoot);
        this._SaveRepoInfo(projectRoot);
        MyLog.Info(`svn checkout completed: ${localPath}`);
    }

    /**
     * 更新本地副本
     * @param {string} localPath - 本地路径
     * @param {string} projectRoot - 项目根 URL
     */
    async _UpdateRepo(localPath, projectRoot) {
        if (!localPath || !fs.existsSync(localPath)) return;

        const entry = this._cacheMap[projectRoot];
        if (!entry) return;
        const lastUpdateFile = path.join(this.cache_root_dir, entry.hash + '.last-update');
        const now = new Date();

        // 检查上次更新时间（默认跳过 24 小时内）
        if (fs.existsSync(lastUpdateFile)) {
            const lastUpdateContent = fs.readFileSync(lastUpdateFile, 'utf-8').trim();
            const lastUpdateTime = new Date(lastUpdateContent);
            const diffHours = (now - lastUpdateTime) / (1000 * 60 * 60);
            if (diffHours < 24) {
                MyLog.Debug(`svn update skipped, last update was ${diffHours.toFixed(1)} hours ago`);
                return;
            }
        }

        MyLog.Info(`svn update: ${localPath}`);
        await this._GetSvnCommandResult(`update "${localPath}"`).catch(SvnCommandApi._ProcessCommandError);
        this._SaveLastUpdateTime(projectRoot);
        this._SaveRepoInfo(projectRoot);
        MyLog.Info(`svn update completed: ${localPath}`);
    }

    /**
     * 保存仓库 URL 到 info 文件
     * @param {string} projectRoot - 项目根 URL
     */
    _SaveRepoInfo(projectRoot) {
        const entry = this._cacheMap[projectRoot];
        if (!entry) return;
        try {
            const infoFile = path.join(this.cache_root_dir, entry.hash + '.info');
            if (!fs.existsSync(infoFile)) {
                fs.writeFileSync(infoFile, projectRoot);
            }
        } catch (e) {
            MyLog.Warn(`save svn repo info failed: ${e.message}`);
        }
    }

    /**
     * 保存上次更新时间
     * @param {string} projectRoot - 项目根 URL
     */
    _SaveLastUpdateTime(projectRoot) {
        const entry = this._cacheMap[projectRoot];
        if (!entry) return;
        try {
            const lastUpdateFile = path.join(this.cache_root_dir, entry.hash + '.last-update');
            fs.writeFileSync(lastUpdateFile, new Date().toISOString());
        } catch (e) {
            MyLog.Warn(`save last update time failed: ${e.message}`);
        }
    }

    /**
     * 从本地 checkout 目录递归列出所有文件
     * @param {string} relativePath - 相对路径
     * @param {string} projectRoot - 项目根 URL（从对照表取缓存目录）
     * @returns {Promise<Array>} 文件列表 [{text, path, size, date}]
     */
    async GetLocalFileList(relativePath = '', projectRoot) {
        const cacheEntry = this._cacheMap[projectRoot];
        if (!cacheEntry) {
            throw new Error('svn cache not initialized for project root: ' + projectRoot);
        }
        const searchPath = relativePath
            ? path.join(cacheEntry.cacheDir, relativePath)
            : cacheEntry.cacheDir;
        const files = [];
        await this._walkDirAsync(searchPath, files, '');
        return files;
    }

    /**
     * 异步递归遍历目录（避免同步 fs 阻塞事件循环）
     * @param {string} dir - 当前目录路径
     * @param {Array} results - 结果数组
     * @param {string} baseRelative - 当前相对路径前缀
     */
    async _walkDirAsync(dir, results, baseRelative) {
        let entries;
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relative = baseRelative
                ? baseRelative.replace(/\\/g, '/') + '/' + entry.name
                : entry.name;

            if (entry.isDirectory()) {
                if (entry.name === '.svn') continue;
                await this._walkDirAsync(fullPath, results, relative);
            } else {
                try {
                    const stat = await fs.promises.stat(fullPath);
                    results.push({
                        text: entry.name,
                        path: relative.replace(/\\/g, '/'),
                        size: stat.size,
                        date: stat.mtime ? MyDate.GetDateStr(stat.mtime, true) : '',
                    });
                } catch (e) {
                    // 跳过无法读取的文件
                }
            }
        }
    }

    /**
     * 搜索仓库文件 - 公开方法
     * @param {string} searchUrl - 搜索起始 URL
     * @param {RegExp} pattern - 编译后的正则
     * @returns {Promise<{matched: array}>}
     */
    async SearchFiles(searchUrl, pattern) {
        // 1. 从搜索路径提取分支级 URL，切换缓存到该级
        const targetUrl = this._ExtractBranchRootFromUrl(searchUrl);
        const projectRoot = this.GetRepoRoot(targetUrl);
        await this.EnsureRepoReady(targetUrl);

        // 2. 相对路径从 targetUrl 算（缓存 switch 后的实际文件层级）
        let relativePath = '';
        if (searchUrl.startsWith(targetUrl)) {
            relativePath = searchUrl.substring(targetUrl.length + 1);
        }

        const RepoSearch = require('./repo_search');
        return RepoSearch.SearchInSvn(this, relativePath, pattern, projectRoot);
    }

    /**
     * 获取项目根（Project Root），即 trunk/branches/tags 的上一级目录。
     * 与 this.repo_root（仓库根/Repo Root）不同，详见类注释"两个根的概念"。
     * @param {*} repo_url 
     * @returns {string} 项目根 URL
     */
    GetRepoRoot(repo_url){
        // 找到第一个 trunk/branches/tags 目录位置（须为完整路径段，避免误匹配分支名如 trunk-buildconf-noapr），返回上级目录
        const parts = repo_url.split('/');
        for(let i = 1; i < parts.length; i++){
            if(parts[i] === 'trunk' || parts[i] === 'branches' || parts[i] === 'tags'){
                return parts.slice(0, i).join('/');
            }
        }
        return repo_url;
    }

    async _GetSvnCommandResult(cmd_params){
        return new Promise((resolve, reject) => {
            const exec = require('child_process').exec;
            if(this.os_type == 'windows'){
                var svn_exe = 'svn.exe';
            }else{
                var svn_exe = 'svn';
            }
            // 密码暴露在命令行中容易泄露，后续需要择期优化
            var auth_part = '';
            if (!MyCheck.IsEmpty(this.user)) {
                auth_part = `--username ${this.user}`;
                if (!MyCheck.IsEmpty(this.password)) {
                    auth_part += ` --password ${this.password}`;
                }
            }
            var cmd_str = `${svn_exe} --non-interactive --trust-server-cert ${auth_part} ${cmd_params}`;
            // 密码脱敏后再日志
            var logCmd = cmd_str.replace(/--password\s+\S+/g, '--password ******');
            MyLog.Debug('exec cmd: ' + logCmd, true);
            // 注意设置缓冲区大小最大为100MB，否则读取大文件时会报错：stdout maxBuffer length exceeded
            exec(cmd_str, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
                if(error){
                    reject(error);
                }else{
                    // 获取输出的字符串
                    resolve(stdout.toString());
                }
            });
        });
    }

    static _ParseXmlToJson(data){
        const options = {
            attributeNamePrefix: "@", // 在属性名称前面添加@前缀
            ignoreAttributes: false, // 不能忽略属性
            parseZeroInvalidTags: true, // 解析零值标签
            textNodeConversion: true, // 转换文本节点
        };
        this.xml_parser = new XmlParser.XMLParser(options);
        // 需要保留节点名字并解析节点中的属性
        let jsonObj = this.xml_parser.parse(data);
        return jsonObj;
    }
    
    static _ProcessCommandError(error){
        var msg = `${error.message}`;
        // 需要替换掉密码相关敏感信息（加 g 标志处理所有出现）
        msg = msg.replace(/--password\s+\S+/g, '--password ******');
        // 如果换行符前面的文字不是标点符号，则替换为一个.
        msg = msg.replace(/([^.;\n\r,。；])\s*\n/g, '$1; \n');
        MyLog.Error(msg);
        error.message = msg;
        throw error;
    }

    static _ParseRepoTree(data){
        /* 输入数据data结构类似
            <?xml version="1.0" encoding="UTF-8"?>
            <lists>
            <list path=".">
            <entry kind="dir">
                <name>.vscode</name>
                <commit revision="6">
                    <author>xxx</author>
                    <date>2024-06-23T03:06:26.566890Z</date>
                </commit>
            </entry>
            <entry kind="file">
                <name>LICENSE</name>
                <size>1074</size>
                <commit revision="6">
                    <author>xxx</author>
                    <date>2024-06-23T03:06:26.566890Z</date>
                </commit>
            </entry>
            </list>
            </lists>
         */
        let jsonObj = this._ParseXmlToJson(data);
        // console.log('json: ' + JSON.stringify(jsonObj));   // debug console
        let entries = jsonObj.lists.list.entry;
        let tree = {
            base: '', path: '', dirs: [], files: []
        };
        if(entries === undefined){
            return tree;
        }
        
        // 需要先判断是否为数组
        if(!Array.isArray(entries)){
            entries = [entries];
        }
        for(let i = 0; i < entries.length; i++){
            let entry = entries[i];
            let kind = entry['@kind'];
            let name = entry.name != null ? String(entry.name) : '';
            let commit = entry.commit;
            let revision = commit['@revision'];
            let author = commit.author;
            let date = this._ParseDate(commit.date);
            if(kind === 'dir'){
                tree.dirs.push({text: name, date: date, children: ['.']});
            }else{
                // 如果是文件，增加size属性，转换为KB，MB，GB等单位
                let size_str = MyUnit.FileSizeStr(entry.size);  // 默认单位为B
                tree.files.push({text: name, revision: revision, author: author, date: date, size: size_str, size_num: parseInt(entry.size)});
            }
        }
        return tree;
    }


    /**
     * 获取基础数据结构，包括路径对应一级目录结构、仓库根目录、服务器根目录等
     * @param {*} repo_url 仓库url，例如 http://mysvn:8888/svn/electron_apps/repo_viewer/trunk
     * @returns json对象，结构如下：
     * {
     *   "url":"http://mysvn:8888/svn/electron_apps/repo_viewer/trunk",
     *   "base":"electron_apps",
     *   "path":"/repo_viewer/trunk",
     *   "dirs":[ {"text":".vscode","date":"2024-06-23 11:06:26","children":["."]},...],
     *   "files":[ {"text":"LICENSE","revision":"6","author":"xxx","date":"2024-06-23 11:06:26","size":"1.05KB"},...], ...},
     *   "server_root":"http://mysvn:8888",
     *   "repo_root":"http://mysvn:8888/svn/electron_apps"
     * }
     */
    async GetRepoTree(repo_url = null){
        if(!repo_url){
            repo_url = this.repo_url;
        }
        if(this.svn_version){
            repo_url += this.svn_version;
        }

        let res = await this._GetSvnCommandResult(`list "${repo_url}" --xml`).catch(SvnCommandApi._ProcessCommandError);
        let res_obj = SvnCommandApi._ParseRepoTree(res);
        res_obj.url = repo_url;

        // 计算仓库根（Repo Root）：/svn/ 后第一级目录为仓库根，与项目根（Project Root）不同
        // 见类注释"两个根的概念"
        var idx = repo_url.indexOf('/svn/');
        var base_and_path = repo_url.substring(idx + 5).split('@')[0].split('/');
        res_obj.base = base_and_path[0];   // base_and_path第一个目录
        res_obj.path = '/' + base_and_path.slice(1).join('/');  // base_and_path剩余部分

        if(!this.server_root){
            // 服务器根目录为url中/svn/之前的部分
            let idx = repo_url.indexOf('/svn/');
            if(idx === -1){
                // 非 /svn/ 布局的仓库（如 Apache: https://svn.apache.org/repos/asf/httpd/...），
                // 用 svn info 获取权威的 repository root，避免硬编码 /svn/ 解析出错导致 diff URL 错误
                await this._InitRepoRootFromInfo(repo_url, res_obj);
            }else{
                this.server_root = repo_url.substring(0, idx);
                this.repo_root = this.server_root + "/svn/" + res_obj.base;  // 仓库根（Repo Root）
            }
            MyLog.Info(`repo info init, repo url: ${repo_url}, server root: ${this.server_root}, repo_root: ${this.repo_root}`);  // TODO debug
        }

        res_obj.server_root = this.server_root;
        res_obj.repo_root = this.repo_root;

        return res_obj;
    }

    /**
     * 刷新数据，由于svn不使用缓存机制，因此直接返回即可
     * @param {*} repo_url 
     */
    async RefreshRepoTree(repo_url){
        return;
    }

    /**
     * 对非 /svn/ 布局的仓库，通过 svn info 获取权威的 repository root 并初始化 server_root / repo_root
     * @param {*} repo_url 
     * @param {*} res_obj 刚解析得到的基础数据结构，会同步更新其中的 base / path
     */
    async _InitRepoRootFromInfo(repo_url, res_obj){
        let info_res, info_json;
        try{
            info_res = await this._GetSvnCommandResult(`info "${repo_url}" --xml`);
            info_json = SvnCommandApi._ParseXmlToJson(info_res);
        }catch(e){
            MyLog.Error(`svn info failed for ${repo_url}: ${e.message}`);
            return;
        }
        let entry = info_json.info && info_json.info.entry;
        if(!entry){
            return;
        }
        let repos_root = entry.repository && entry.repository.root;
        let cur_url = entry.url || repo_url;
        if(!repos_root){
            return;
        }
        repos_root = String(repos_root).replace(/\/+$/, '');
        // repository root 即仓库根（Repo Root）
        this.repo_root = repos_root;
        // server_root 为 repository root 中携带协议/主机部分
        var scheme_match = repos_root.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\/]+)/);
        this.server_root = scheme_match ? scheme_match[1] : '';
        // 与 /svn/ 分支一致：base 取仓库根最后一段，path 为仓库根之后的完整剩余路径
        var after = cur_url.substring(repos_root.length).split('@')[0].replace(/^\/+/, '');
        var segs = after.split('/');
        res_obj.base = repos_root.split('/').pop() || '';
        res_obj.path = '/' + (after || '');
    }

    async GetRepoFileContent(file_url, version=null){
        if(this.svn_version && version === null){
            file_url += this.svn_version;
        }
        MyLog.Info('get content of: ' + file_url + (version ? ' with version: ' + version : ''));
        var des_url = file_url;
        // 如果指定版本，则需要在url中repo_root后添加版本号，地址类似 http://svn.mine/svn/electron_apps/!svn/ver/9/repo_viewer/trunk/module/svn_web_api.js
        if(version !== null){
            des_url = `${des_url}@${version}`;
        }

        let res = await this._GetSvnCommandResult(`cat "${des_url}"`).catch(SvnCommandApi._ProcessCommandError);
        // console.log(res.data);  // debug console
        return res;
    }

    // 导出文件到指定位置，dest_path为目标文件位置
    async ExportRepoFile(file_url, dest_path, version=null){
        if(this.svn_version && version === null){
            file_url += this.svn_version;
        }
        MyLog.Info('get file of: ' + file_url + (version ? ' with version: ' + version : ''));
        var des_url = file_url;
        // 如果指定版本，则需要在url中repo_root后添加版本号，地址类似 http://svn.mine/svn/electron_apps/!svn/ver/9/repo_viewer/trunk/module/svn_web_api.js
        if(version !== null){
            des_url = `${des_url}@${version}`;
        }

        let res = await this._GetSvnCommandResult(`export --force "${des_url}" "${dest_path}"`).catch(SvnCommandApi._ProcessCommandError);
        // console.log(res.data);  // debug console
        return res;
    }

    /**
     * 获取提交日志及每次提交涉及的文件列表
     * @param {*} repo_url 
     * @param {*} start_rev 起始版本号，不包含该版本
     * @param {*} end_rev 结束版本号，不包含该版本
     * @returns 
     */
    async GetRepoLog(repo_url, start_rev=null, end_rev=null){
        if(this.svn_version){
            repo_url += this.svn_version;
        }
        MyLog.Info('get log of: ' + repo_url)

        let ver_str = '', limit_str='', limit_num = 50;
        if (start_rev && end_rev){
            end_rev = parseInt(end_rev) - 1;
            start_rev = parseInt(start_rev) + 1;
            if (start_rev >= end_rev){
                return [];
            }
            ver_str = `-r ${end_rev}:${start_rev}`;
        }else if(!start_rev && end_rev){
            end_rev = parseInt(end_rev) - 1;
            if (end_rev <= 0){
                return [];
            }
            // More 分页：从上次最后一条 revision 往前数 limit_num 条触及该路径的记录。
            // 用 --limit 而非固定 revision 区间，避免全局 revision 稀疏时区间内恰好无触及提交而返回空。
            ver_str = `-r ${end_rev}:1`;
            limit_str = `--limit ${limit_num}`;
        }else{
            limit_str = `--limit ${limit_num}`;
        }
        let cmd_params = `log "${repo_url}" ${ver_str} ${limit_str} --xml -v`;
        let res = await this._GetSvnCommandResult(cmd_params).catch(SvnCommandApi._ProcessCommandError);
        // console.log(res);  // debug console

        let jsonObj = SvnCommandApi._ParseXmlToJson(res);
        /**
         * 原始数据格式如下：
        <log>
          <logentry revision="5">
            <author>xxxx</author>
            <date>2024-06-23T03:04:23.109994Z</date>
            <paths>
            <path action="A" prop-mods="false" text-mods="false" kind="dir">/app_tmpl/trunk/.vscode</path>
            ...
            </paths>
            <msg>xxx</msg>
          </logentry>
        </log>
         */
        //console.log(JSON.stringify(jsonObj));  // debug console
        let res_obj = [];
        let logs = jsonObj['log']['logentry'];
        if(logs === undefined){
            return res_obj;
        }
        if(!Array.isArray(logs)){
            logs = [logs];
        }

        for(let i = 0; i < logs.length; i++){
            let log = logs[i];
            let item = {};
            item['revision'] = log['@revision'];
            item['date'] = SvnCommandApi._ParseDate(log['date']);
            item['msg'] = log['msg'];
            item['author'] = log['author'];
            item['files'] = [];
            if(log.hasOwnProperty('paths')){
                let paths = log['paths']['path'];
                if(!Array.isArray(paths)){
                    paths = [paths];
                }
                for(let j = 0; j < paths.length; j++){
                    let path = paths[j];
                    let copy_from = "";
                    if(path.hasOwnProperty('@copyfrom-path')){
                        copy_from = path["@copyfrom-path"] + "@" + path["@copyfrom-rev"]
                    }
                    let path_node = {action: path["@action"], path: path["#text"], kind: path['@kind'], text_mods:path['@text-mods'], prop_mods: path['@prop-mods'], copy_from:copy_from, revision: item['revision']}
                    item['files'].push(path_node);
                }
            }
            res_obj.push(item);
        }
        return res_obj;
    }

    /**
     * 获取SVN文件属性信息
     * @param {*} file_url 
     * @returns 
     */
    async GetRepoProperty(file_url, version=null){
        if(this.svn_version && version === null){
            file_url += this.svn_version;
        }
        var des_url = file_url;
        if(version !== null){
            des_url = `${file_url}@${version}`;
        }

        let res = await this._GetSvnCommandResult(`proplist -v "${des_url}" --xml`).catch(SvnCommandApi._ProcessCommandError);
        /**
         * 返回数据结构如下：
        <properties>
        <target path="http://xxx/svn/test/trunk">
            <property name="svn:externals">http://xxxx/trunk lib/repo_viewer&#13;
        http://xxxxxx/trunk lib/tmpl&#13;
            </property>
        </target>
        </properties>
         */

        let jsonObj = SvnCommandApi._ParseXmlToJson(res);

        // console.log(JSON.stringify(jsonObj));  // debug console

        let res_obj = {};
        if(jsonObj['properties']['target'] === undefined || jsonObj['properties']['target']['property'] === undefined){
            return res_obj;
        }
        let properties = jsonObj['properties']['target']['property'];
        if(!Array.isArray(properties)){
            properties = [properties];
        }
        // 找到href与file_url相同的response，href为url去掉server_root的部分
        for(let i = 0; i < properties.length; i++){
            let cur_propert = properties[i];
            let key = cur_propert['@name'];
            // 注意转换 &#13 等特殊字符
            res_obj[key] = cur_propert["#text"].replace(/&#13;/g, "").replace(/&#10;/g, "\n").replace(/&#9;/g, "\t");
        }
        // console.log(JSON.stringify(res_obj));  // debug console

        return res_obj;
    }

    /**
     * 获取两个版本及其之间的变更差异
     * @param {*} file_url 
     * @param {*} begin 注意，需要获取的变更包含begin版本的提交
     * @param {*} end  注意，需要获取的变更包含end版本的提交
     * @returns 
     */
    async GetRepoFileDiff(file_url, begin, end, copy_src_url=null){
        var pre_content = '', new_content = '';
        if(begin !== null){
            begin = parseInt(begin);
            // 跨 copy 时，旧版本内容从 copy 来源路径获取
            pre_content = await this.GetRepoFileContent(copy_src_url ? copy_src_url : file_url, begin - 1 );
        }
        if(end !== null){
            end = parseInt(end);
            new_content = await this.GetRepoFileContent(file_url, end);
        }
        return {title:`${file_url} ${begin}:${end}`, pre: pre_content, new: new_content};
    }

    /**
     * 获取两个版本及其之间的属性变更差异
     * @param {*} file_url 
     * @param {*} begin 注意，需要获取的变更包含begin版本的提交
     * @param {*} end 注意，需要获取的变更包含
     * @returns 
     */
    async GetRepoPropertyDiff(file_url, begin, end){
        var pre_prop = '', new_prop = '';
        if(begin !== null){
            begin = parseInt(begin);
            pre_prop = await this.GetRepoProperty(file_url, begin - 1 );
            pre_prop = JSON.stringify(pre_prop, null, 2).replace(/\\n/g, '\n');
        }
        if(end !== null){
            end = parseInt(end);
            new_prop = await this.GetRepoProperty(file_url, end);
            new_prop = JSON.stringify(new_prop, null, 2).replace(/\\n/g, '\n');
        }
        return {title:`${file_url} ${begin}:${end}`, pre: pre_prop, new: new_prop};
    }

    /**
     * 获取可进行分支比对的分支列表（含主线 trunk/main/master 及其余分支）
     * @param {string} selUrl 当前选中的仓库路径
     * @returns {Promise<{baseRoot, baseBranchName, defaultBranch, branches:[{name,url}]}>}
     */
    async GetBranchList(selUrl){
        const baseRoot = this._ExtractBranchRootFromUrl(selUrl);
        const projectRoot = this.GetRepoRoot(baseRoot);

        // 1. 顶层目录：确定主线（trunk/main/master）及存在的 branches/tags 目录
        let topNames = [];
        try{
            const topRes = await this._GetSvnCommandResult(`list "${projectRoot}" --xml`).catch(SvnCommandApi._ProcessCommandError);
            topNames = SvnCommandApi._ParseRepoTree(topRes).dirs.map(d => d.text);
        }catch(e){ topNames = []; }

        // 2. 归类：非 branches/tags 的顶层目录视为"线"（如 trunk/main/master），优先 trunk/main/master
        const lineNames = topNames.filter(n => n !== 'branches' && n !== 'tags');
        let defaultName = null;
        for(const p of ['trunk', 'main', 'master']){
            if(lineNames.indexOf(p) !== -1){ defaultName = p; break; }
        }
        if(!defaultName && lineNames.length){ defaultName = lineNames[0]; }

        const branches = [];
        for(const n of lineNames){
            branches.push({ name: n, url: `${projectRoot}/${n}` });
        }

        // 3. branches 目录下的子分支
        if(topNames.indexOf('branches') !== -1){
            try{
                const brRes = await this._GetSvnCommandResult(`list "${projectRoot}/branches" --xml`).catch(SvnCommandApi._ProcessCommandError);
                for(const bn of SvnCommandApi._ParseRepoTree(brRes).dirs.map(d => d.text)){
                    branches.push({ name: bn, url: `${projectRoot}/branches/${bn}` });
                }
            }catch(e){ /* 分支目录不可读时忽略 */ }
        }

        // 4. 当前选中分支名（用于标题展示）
        const baseParts = baseRoot.substring(projectRoot.length).replace(/^\/+/, '').split('/').filter(Boolean);
        const baseBranchName = baseParts.length ? baseParts[baseParts.length - 1] : projectRoot;

        // 5. 默认比对目标：主线 trunk/main/master
        let defaultBranch = defaultName ? `${projectRoot}/${defaultName}` : (branches.length ? branches[0].url : '');

        // 6. 若当前分支名含 _rf_，默认与去掉 _rf_ 及之后内容的分支比对；该分支不存在则退回主线
        if(baseBranchName.indexOf('_rf_') !== -1){
            const parentName = baseBranchName.split('_rf_')[0];
            const found = branches.find(b => b.name === parentName);
            if(found){ defaultBranch = found.url; }
        }

        return {
            baseRoot,
            baseBranchName,
            defaultBranch,
            branches
        };
    }

    /**
     * 比对两个分支树，返回变更文件列表
     * @param {string} baseRoot 源分支根 URL
     * @param {string} targetRoot 目标分支根 URL
     * @returns {Promise<Array>} [{status, path, baseUrl, targetUrl}]
     */
    async CompareBranches(baseRoot, targetRoot, compareMode = 'base'){
        // 目标分支(如trunk)作为"源"/基线，当前分支作为"新"
        // compareMode: 'base'=与目标分支拉分支时的版本比对(默认); 'latest'=与目标分支最新版比对
        const forkRev = compareMode === 'base' ? await this._ResolveForkRev(baseRoot) : null;
        const oldRef = forkRev ? `${targetRoot}@${forkRev}` : targetRoot;

        // 缓存键区分比对模式，避免 base/latest 互相串
        const cacheKey = compareMode === 'base'
            ? `${baseRoot}|${targetRoot}@${forkRev || 'HEAD'}`
            : `${baseRoot}|${targetRoot}@HEAD`;
        const hit = this._branchDiffCache[cacheKey];
        const MAX_AGE = 60 * 1000;  // 60s内同一对(源,目标参考版本)复用摘要
        if(hit && (Date.now() - hit.time) < MAX_AGE){ return hit.data; }

        const res = await this._GetSvnCommandResult(`diff --summarize --old "${oldRef}" --new "${baseRoot}"`)
            .catch(SvnCommandApi._ProcessCommandError);
        const data = SvnCommandApi._ParseSummarizeDiff(res, targetRoot, baseRoot);
        // base 模式下，旧/源侧内容固定到拉分支版本，文件级 diff 据此取目标分支拉分支时的内容
        if(forkRev){
            for(const it of data){
                if(it.baseUrl){ it.baseUrl = `${it.baseUrl}@${forkRev}`; }
            }
        }
        this._branchDiffCache[cacheKey] = { time: Date.now(), data };
        return data;
    }

    /**
     * 解析当前分支的拉分支版本：svn log --stop-on-copy 最旧一条日志的版本号即分支创建(拉分支)版本
     */
    async _ResolveForkRev(baseBranchUrl){
        if(this._forkRevCache[baseBranchUrl]){ return this._forkRevCache[baseBranchUrl]; }
        let rev = null;
        try{
            const out = await this._GetSvnCommandResult(`log --stop-on-copy -q "${baseBranchUrl}"`);
            const lines = String(out || '').split(/\r?\n/);
            for(let i = lines.length - 1; i >= 0; i--){
                const m = lines[i].match(/^r(\d+)/);
                if(m){ rev = m[1]; break; }
            }
        }catch(e){ rev = null; }
        this._forkRevCache[baseBranchUrl] = rev;
        return rev;
    }

    /**
     * 解析 svn diff --summarize 输出为变更文件列表
     * 注意：调用时已按「目标分支为源」交换传参，故本函数中 baseRoot 实为"旧/源"侧、targetRoot 实为"新"侧
     * @param {string} text
     * @param {string} baseRoot 旧/源侧分支根（传入的 targetRoot）
     * @param {string} targetRoot 新侧分支根（传入的 baseRoot）
     */
    static _ParseSummarizeDiff(text, baseRoot, targetRoot){
        const list = [];
        const lines = String(text || '').split(/\r?\n/);
        for(const ln of lines){
            if(!ln.trim()) continue;
            // 形如: "M       /repo/trunk/foo/bar.c"
            const m = ln.match(/^(\S+)\s+(.+)$/);
            if(!m) continue;
            const status = m[1].trim()[0];
            if(!['M', 'A', 'D'].includes(status)) continue;
            const fullPath = m[2].trim();

            let rel = null;
            if(fullPath.startsWith(baseRoot)){ rel = fullPath.substring(baseRoot.length); }
            else if(fullPath.startsWith(targetRoot)){ rel = fullPath.substring(targetRoot.length); }
            else { rel = fullPath; }
            rel = rel.replace(/^\/+/, '');

            let baseUrl = null, targetUrl = null;
            if(status === 'A'){
                // A: 仅存在于"新"(当前分支)侧
                targetUrl = `${targetRoot}/${rel}`;
            }else if(status === 'D'){
                // D: 仅存在于"旧/源"(目标分支/trunk)侧
                baseUrl = `${baseRoot}/${rel}`;
            }else{
                // M: 两侧均存在
                baseUrl = `${baseRoot}/${rel}`;
                targetUrl = `${targetRoot}/${rel}`;
            }
            list.push({ status, path: rel, baseUrl, targetUrl });
        }
        return list;
    }

    /**
     * 获取单个文件的跨分支差异内容（两侧均取 HEAD）
     * @param {string} baseUrl 源分支文件 URL，可为 null（目标新增）
     * @param {string} targetUrl 目标分支文件 URL，可为 null（源分支独有）
     * @returns {Promise<{title, pre, new}>}
     */
    async GetBranchFileDiff(baseUrl, targetUrl){
        let pre = '', new_content = '';
        if(baseUrl){
            try{ pre = await this.GetRepoFileContent(baseUrl); }catch(e){ pre = ''; }
        }
        if(targetUrl){
            try{ new_content = await this.GetRepoFileContent(targetUrl); }catch(e){ new_content = ''; }
        }
        return { title: `${baseUrl || '(none)'} ↔ ${targetUrl || '(none)'}`, pre: pre, new: new_content };
    }

    // 其他工具函数
    static _ParseDate(svn_date){
        return MyDate.GetDateStr(new Date(svn_date), true);
    }
}

module.exports = SvnCommandApi;