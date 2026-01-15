const axios = require('axios');
const https = require('https'); 
const Buffer = require('buffer').Buffer; // 如果使用 Node.js v12+，需要引入 Buffer 模块 
const XmlParser = require('fast-xml-parser');
const {MyDate} = require('../util/my_util')

/**
 * SVN Web API, 通过WebDAV协议获取SVN远程仓库的信息
 * 
 * 远程http接口说明：
 * 1. 获取目录及文件内容信息：GET请求，返回xml格式数据
 * 2. 获取属性信息：PROPFIND请求，返回xml格式数据
 * 3. 获取提交记录：REPORT请求，返回xml格式数据
 * 4. 获取特定版本属性信息：PROPFIND 请求 URL: http://svn.mine/svn/electron_apps/!svn/rvr/9/repo_viewer/trunk/module/svn_web_api.js
 * 5. 获取特定版本文件内容：GET 请求 http://svn.mine/svn/electron_apps/!svn/ver/9/repo_viewer/trunk/module/svn_web_api.js
 * 6. 获取特定版本提交文件：REPORT 请求 http://svn.mine/svn/electron_apps/!svn/rev/9
 */
class SvnWebApi{
    constructor(repo_url, user, password) {
        this.repo_url = repo_url;
        this.repo_root = null;   // 仓库根目录，真实repo，非逻辑repo
        this.server_root = null;  // 服务器根目录，即/svn/之前的部分
        this.user = user;
        this.password = password;

        this.axios = SvnWebApi._CreateAxios(user, password, false);
    }

    static _EncodePassword(user, password){
        // 将用户名和密码编码为 Base64
        const encodedCredentials = Buffer.from(`${user}:${password}`).toString('base64');
        return `Basic ${encodedCredentials}`;
    }

    static _CreateAxios(user, password, use_https=false){
        let http_ops = {
            /*auth: {
                username: user,
                password: password
            },*/
            headers: {
                Depth: '1',  // 请求目录信息深度
                Authorization: SvnWebApi._EncodePassword(user, password),
                Accept: '*/*',  // 返回xml格式数据
            },
        }
        // TODO 如果是私人证书还要设置ca信任，这里不处理。因此目前https协议处理可能会有问题
        // 如果为https请求，需要设置agent来忽略证书异常
        if(use_https){
            const agent = new https.Agent({  
                rejectUnauthorized: false  
            });
            http_ops.httpsAgent = agent;
        }
        return axios.create(http_ops);
    }

    static _ParseXmlToJson(data){
        const options = {
            attributeNamePrefix: "@", // 在属性名称前面添加@前缀
            ignoreAttributes: false, // 不能忽略属性
            parseZeroInvalidTags: true, // 解析零值标签
        };
        this.xml_parser = new XmlParser.XMLParser(options);
        // 需要保留节点名字并解析节点中的属性
        let jsonObj = this.xml_parser.parse(data);
        return jsonObj;
    }

    /**
     * 将返回的xml格式的数据解析为json结构
     * @param {*} data, 结构类似：
        <svn version="1.14.2 (r1899510)" href="http://subversion.apache.org/">
            <index rev="6" path="/tmpl/trunk" base="apps">
                <updir href="../"/>
                <dir name=".vscode" href=".vscode/"/>
                <file name="LICENSE" href="LICENSE"/>
                <file name="README.md" href="README.md"/>
            </index>
        </svn>
     * @returns {base: 'xxx', path='xxx', dirs: [{text: 'xxx'}], , files: [{text: 'xxx'}]}
     */
    static _ParseRepoTree(data){
        // console.log('xml: ' + data);   // TODO debug
        let jsonObj = this._ParseXmlToJson(data);
        let index = jsonObj.svn.index;
        let tree = {
            base: index['@base'], path: index['@path'], dirs: [], files: []
        };
        // 如果存在index.dir, 则其dir中的元素都为目录；如果存在file元素，则file的子元素都为文件
        if(index.hasOwnProperty('dir')){
            // 需要先判断是否为数组
            if(!Array.isArray(index.dir)){
                index.dir = [index.dir];
            }
            // 遍历数组dir元素
            for(let i = 0; i < index.dir.length; i++){
                let cur_dir = index.dir[i];
                let name = cur_dir['@name'];
                tree.dirs.push({text: name, children: ['.']});
            }
        }
        if(index.hasOwnProperty('file')){
            if(!Array.isArray(index.file)){
                index.file = [index.file];
            }
            for(let i = 0; i < index.file.length; i++){
                let cur_file = index.file[i];
                let name = cur_file['@name'];
                tree.files.push({text: name});
            }
        }

        return tree;
    }

    static _ProcessAxiosError(error){
        var msg = `${error.config.method} ${error.config.url} fail, ${error.message}, code: ${error.code}`;
        console.error(msg, error);
        error.message = msg;
        throw error;
    }

    async GetRepoTree(repo_url = null){
        if(!repo_url){
            repo_url = this.repo_url;
        }

        //let res = await this.axios.get(repo_url).catch(error => {
        let res = await this.axios.request({
            url: repo_url,
            method: 'GET',     // 可选 GET、PROPFIND、REPORT, GET请求获取目录信息，PROPFIND获取属性信息，REPORT获取提交信息
        }).catch(SvnWebApi._ProcessAxiosError);
        let res_obj = SvnWebApi._ParseRepoTree(res.data);
        res_obj.url = repo_url;

        if(!this.server_root){
            // 服务器根目录为url中/svn/之前的部分
            let idx = repo_url.indexOf('/svn/');
            this.server_root = repo_url.substring(0, idx);
            console.log(`repo url: ${repo_url} \nserver root: ${this.server_root}`);  // TODO debug
        }

        if(!this.repo_root){
            this.repo_root = this.server_root + "/svn/" + res_obj.base;
            console.log('repo root: ' + this.repo_root);  // TODO debug
        }

        res_obj.server_root = this.server_root;
        res_obj.repo_root = this.repo_root;

        return res_obj;
    }

    async GetRepoFileContent(file_url, version=null){
        console.log('get content of: ' + file_url + version ? ' with version: ' + version : '');
        // 如果指定版本，则需要在url中repo_root后添加版本号，地址类似 http://svn.mine/svn/electron_apps/!svn/ver/9/repo_viewer/trunk/module/svn_web_api.js
        if(version !== null){
            console.log('get content of: ' + file_url + ' repo_root: ' + this.repo_root)
            let file_path = file_url.replace(this.repo_root, '');
            file_url = `${this.repo_root}/!svn/ver/${version}${file_path}`;
        }

        let res = await this.axios.request({
            url: file_url,
            method: 'GET',
            responseType: 'text',  // 返回文本内容
        }).catch(SvnWebApi._ProcessAxiosError);
        // console.log(res.data);  // TODO debug
        return res.data;
    }

    // 获取提交日志及每次提交涉及的文件列表
    async GetRepoLog(repo_url, start_rev=null, end_rev=0){
        console.log('get log of: ' + repo_url)
        // <S:log-report xmlns:S="svn:"><S:end-revision>0</S:end-revision><S:limit>26</S:limit><S:encode-binary-props /><S:path></S:path></S:log-report>
        let start_str = '';
        if (start_rev){
            start_str = `<S:start-revision>${start_rev}</S:start-revision>`;
        }
        let res = await this.axios.request({
            url: repo_url,
            method: 'REPORT',
            data: `<?xml version="1.0" encoding="utf-8"?>
            <S:log-report xmlns:S="svn:">
                <S:limit>30</S:limit>
                <S:encode-binary-props />
                <S:path></S:path>
                ${start_str}
                <S:end-revision>${end_rev}</S:end-revision>
                <S:discover-changed-paths/>
            </S:log-report>`,
        }).catch(SvnWebApi._ProcessAxiosError);
        //console.log(res.data);  // TODO debug

        /**
         * 解析结果，格式类似
        <S:log-report xmlns:S="svn:" xmlns:D="DAV:">
          <S:log-item>
            <S:added-path node-kind="dir" text-mods="false" prop-mods="false">/repo_viewer/trunk/.vscode</S:added-path>
            <S:modified-path node-kind="file" text-mods="true" prop-mods="false">/repo_viewer/trunk/main.js</S:modified-path>
            <D:version-name>5</D:version-name>
            <S:date>2024-06-23T03:04:23.109994Z</S:date>
            <D:comment>增加初稿</D:comment>
            <D:creator-displayname>xl</D:creator-displayname>
          </S:log-item>
          <S:log-item>
            xxxx
          </S:log-item>
        </S:log-report>
        */
        let jsonObj = SvnWebApi._ParseXmlToJson(res.data);
        // console.log(JSON.stringify(jsonObj));  // TODO debug
        let res_obj = [];
        let logs = jsonObj['S:log-report']['S:log-item'];
        if(!Array.isArray(logs)){
            logs = [logs];
        }

        for(let i = 0; i < logs.length; i++){
            let log = logs[i];
            let item = {};
            item['revision'] = log['D:version-name'];
            // 将 2024-06-23T03:06:26.566890Z 转换为本地日期
            item['date'] = MyDate.GetDateStr(new Date(log['S:date']), true);
            item['msg'] = log['D:comment'];
            item['author'] = log['D:creator-displayname'];
            item['files'] = [];
            if(log.hasOwnProperty('S:added-path')){
                let added_path = log['S:added-path'];
                if(!Array.isArray(added_path)){
                    added_path = [added_path];
                }
                for(let j = 0; j < added_path.length; j++){
                    let path = added_path[j];
                    item['files'].push({action: 'A', path: path["#text"], kind: path['@node-kind'], text_mods:path['@text-mods'], prop_mods: path['@prop-mods']});
                }
            }
            if(log.hasOwnProperty('S:modified-path')){
                let modified_path = log['S:modified-path'];
                if(!Array.isArray(modified_path)){
                    modified_path = [modified_path];
                }
                for(let j = 0; j < modified_path.length; j++){
                    let path = modified_path[j];
                    item['files'].push({action: 'M', path: path["#text"], kind: path['@node-kind'], text_mods:path['@text-mods'], prop_mods: path['@prop-mods']});
                }
            }
            if(log.hasOwnProperty('S:deleted-path')){
                let deleted_path = log['S:deleted-path'];
                if(!Array.isArray(deleted_path)){
                    deleted_path = [deleted_path];
                }
                for(let j = 0; j < deleted_path.length; j++){
                    let path = deleted_path[j];
                    item['files'].push({action: 'D', path: path["#text"], kind: path['@node-kind'], text_mods:path['@text-mods'], prop_mods: path['@prop-mods']});
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
        if(version !== null){
            let file_path = file_url.replace(this.repo_root, '');
            file_url = `${this.repo_root}/!svn/rvr/${version}${file_path}`;
        }

        /**
         * 返回格式如下：
         * D:multistatus{
         *   D:response:[{
         *     D:href,          // href为url去掉server_root的部分
         *     D:propstat:[{        // 第一个propstat为目录有效属性，第二个为文件修改日期、版本等信息。但是json解析后会合并到一个对象
         *       D:prop:{
         *         S:externals
         *       }
         *     }]
         *   }]
         * }
         */
        let res = await this.axios.request({
            url: file_url,
            method: 'PROPFIND',
        }).catch(SvnWebApi._ProcessAxiosError);

        let jsonObj = SvnWebApi._ParseXmlToJson(res.data);

        //console.log(JSON.stringify(jsonObj));  // TODO debug

        let res_obj = {};
        let response = jsonObj['D:multistatus']['D:response'];
        if(!Array.isArray(response)){
            response = [response];
        }
        // 找到href与file_url相同的response，href为url去掉server_root的部分
        for(let i = 0; i < response.length; i++){
            let resp = response[i];
            let href = resp['D:href'].replace(/\/$/g, '');  // 去掉末尾的斜杠
            if(href === file_url.replace(this.server_root, '')){
                let propstat = resp['D:propstat'];
                if(!Array.isArray(propstat)){
                    propstat = [propstat];
                }
                let prop = propstat[0]['D:prop'];
                let keys = Object.keys(prop);
                for(let k = 0; k < keys.length; k++){
                    // 只将S:打头的属性保存，并去掉S:前缀
                    let key = keys[k];
                    if(key.startsWith('S:')){
                        res_obj[key.substring(2)] = prop[key];
                    }
                }
                break;
            }else{
                console.log('href: ' + href + ' not match ' + file_url);
            }
        }

        // console.log(JSON.stringify(res_obj));  // TODO debug

        return res_obj;
    }

    async GetRepoFileDiff(file_url, begin, end){
        var pre_content = '', new_content = '';
        if(begin !== null){
            pre_content = await this.GetRepoFileContent(file_url, begin);
        }
        if(end !== null){
            var new_content = await this.GetRepoFileContent(file_url, end);
        }
        return {pre: pre_content, new: new_content};
    }

    async GetRepoPropertyDiff(file_url, begin, end){
        var pre_prop = '', new_prop = '';
        if(begin !== null){
            pre_prop = await this.GetRepoProperty(file_url, begin);
            pre_prop = JSON.stringify(pre_prop, null, 2).replace(/\\n/g, '\n');
        }
        if(end !== null){
            new_prop = await this.GetRepoProperty(file_url, end);
            new_prop = JSON.stringify(new_prop, null, 2).replace(/\\n/g, '\n');
        }
        return {pre: pre_prop, new: new_prop};
    }
}

module.exports = SvnWebApi;