const MyLog = require('../util/my_log')
const {MyString} = require('../util/my_util')
const SvnWebApi = require('./svn_web_api')
const SvnCommandApi = require('./svn_command_api')
const GitCommandApi = require('./git_command_api');

class RepoViewer{
    /**
     * 初始化
     * @param {*} repo_url 
     * @param {*} user 
     * @param {*} password 
     * @param {*} api_type api类型，可选 webdav,command
     */
    constructor(repo_url, user, password, os_type='linux', repo_cache_dir=null) {
        this.repo_url = repo_url;
        this.user = user;
        this.password = password;

        const repo_type = this._GetRepoType(this.repo_url);
        if (repo_type === 'svn') {
            this.api = new SvnCommandApi(this.repo_url, this.user, this.password, os_type);
        } else {
            this.api = new GitCommandApi(this.repo_url, this.user, this.password, os_type, repo_cache_dir);
        }
    }

    /**
     * 根据repo_url自动判断是git还是svn
     */
    _GetRepoType(repo_url){
        // 判断是否为git仓库，以git@开头或以.git结尾的URL通常是git仓库
        if (repo_url.endsWith('.git') || repo_url.includes('git@') || repo_url.includes('.git/')) {
            return 'git';
        } else {
            return 'svn';
        }
    }

    Api(){
        return this.api;
    }

}

module.exports = RepoViewer;