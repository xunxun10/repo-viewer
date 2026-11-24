
// 判断当前查看的仓库是否为 git 仓库（与后台 RepoViewer._GetRepoType 保持一致）
function _IsGitRepoView(){
    var url = gv.gv_repo_url || '';
    return url.endsWith('.git') || url.includes('git@') || url.includes('.git/');
}

// 当前日志弹框中选中的行索引，用于按需加载文件列表完成后重新渲染
var _log_selected_indexs = [];
// 正在请求文件列表的提交，避免重复请求（仅在同一个日志弹框内有效）
var _log_commit_files_loading = {};
// 当前日志弹框对应的仓库路径：后台返回日志时回传的请求路径。
// 提交文件列表是按该路径过滤的，缓存和过滤都必须以它为基准，不能直接用当前选择路径
// （用户可能在日志返回前切换了目录/文件）。
var _log_dialog_path = '';

// 将包含{revision, author, date, msg}的数组转换为html字符串
// path: 本次日志数据对应的请求路径，缺省时取当前选择路径
function ShowLogDialog(v, path){
    _log_dialog_path = path || _GetSelPath();
    var html = `<div id='log-item-container'><table><thead><tr class='log-item log-item-head'>
    <th class='log-item-col log-item-revision'>Revision</th>
    <th class='log-item-col log-item-author'>Author</th>
    <th class='log-item-col log-item-date'>Date</th>
    <th class='log-item-col log-item-msg'>Message</th>
    </tr></thead>`
    html += '<tbody id="log-item-tbody">';
    if(Array.isArray(v) && v.length === 0){
        // 无提交记录：区分 git 分支相对 master 无差异的情况，给出明确提示而非空白面板
        var _sel_path = _log_dialog_path || '';
        var _empty_tip = '未获取到提交记录';
        if(_sel_path.indexOf('.git/branches/') !== -1){
            _empty_tip = '该分支相对于 master 没有独立提交（分支与 master 可能指向同一提交），因此没有可展示的提交记录。';
        }
        html += `<tr class='log-empty-tip'><td colspan='4'>${_empty_tip}</td></tr>`;
    }else{
        html += _GenLogMegHtml(v);
    }
    html += '</tbody></table></div>';
    gv.gv_log_data = v;
    // 重置按需加载状态：git 提交的文件列表在点击提交时再获取
    _log_selected_indexs = [];
    _log_commit_files_loading = {};
    // 显示修改的文件列表 v.files:[{path, action}]
    html += `<div id='log-file-container'></div><div id='log-msgs-container'></div>`;
    // git 仓库支持强制拉取远端更新后刷新提交记录
    var _op_btns = `<button id='more-log-btn' class='btn btn-default'><span class=''>More</span></button>`;
    if(_IsGitRepoView()){
        _op_btns = `<button id='refresh-log-btn' class='btn btn-default' title='强制更新当前分支缓存（fetch + rebase）并重新加载提交记录'>Refresh</button>` + _op_btns;
    }
    html += `<div id='log-operation'>${_op_btns}</div>`;

    MyModal.Info(html, `${_log_dialog_path} commit log`);

    var _last_shift_click = null;
    // 设置点击事件，可按住shift+鼠标同时选中多条
    $("#log-item-tbody").on('mousedown', ".log-item-row", function(e){
        // 判断必须为鼠标左键
        if(e.button != 0){
            return;
        }
        var cur = $(this);
        if(e.shiftKey){
            // 先取消所有active状态
            $(".log-item-row").removeClass('active');
            // 将_last_shift_click和cur之间的元素选中
            var cur_index = cur.index();
            var last_index = _last_shift_click !== null ? _last_shift_click.index() : 0;
            var start = Math.min(cur_index, last_index);
            var end = Math.max(cur_index, last_index);

            // 遍历所有actice元素，将index存入数组
            var active_index = [];
            for(var i = start; i <= end; i++){
                $(".log-item-row").eq(i).addClass('active');
                active_index.push(i);
            }
            if(active_index.length > 0){
                var begin_ver = $(".log-item-row").eq(end).find('.log-item-revision').text();
                var end_ver = $(".log-item-row").eq(start).find('.log-item-revision').text();
                gv.gv_selected_log_version = [begin_ver, end_ver];
            }
            ShowLogMsg(active_index);
            ShowLogFiles(active_index);
            // console.log(`select indexs: ${active_index}`);  // debug console
        }else{
            // 单击事件
            $(".log-item-row").removeClass('active');
            $(this).addClass('active');
            var selected_log_vision = $(this).find('.log-item-revision').text();
            gv.gv_selected_log_version = [selected_log_vision, selected_log_vision];
            var active_index = [$(this).index()];
            ShowLogMsg(active_index);
            ShowLogFiles(active_index);
            // console.log(`select indexs: ${active_index}`);  // debug console

            _last_shift_click = cur;
        }
    });

    $("#more-log-btn").off('click').on('click', function(){
        // 获取当前最后一条日志的版本号
        if(gv.gv_log_data.length == 0){
            Info('no log data, nothing to load');
            return;
        }
        var last_log_index = gv.gv_log_data.length - 1;
        var last_log_revision = gv.gv_log_data[last_log_index].revision;
        // 继续沿用弹框打开时的路径，保证追加的日志与当前列表来自同一目录/文件
        CallSys('get-more-repo-log', {path:_log_dialog_path, from_revision:last_log_revision});
    });

    $("#refresh-log-btn").off('click').on('click', function(){
        var $btn = $(this);
        if($btn.prop('disabled')){
            return;
        }
        // 强制后台更新当前分支缓存（fetch + checkout + rebase），完成后由 show-refreshed-repo-log 重建列表
        $btn.prop('disabled', true).text('Refreshing...');
        CallSys('refresh-repo-log', _log_dialog_path);
    });

    // 默认点击第一行
    if(v.length > 0){
        $(".log-item-row").first().trigger({
            type: 'mousedown',
            button: 0 // 0 表示鼠标左键
        });
    }
}

/**
 * 追加日志信息到日志展示区域
 * @param {list} v 
 */
function AppendLogMsg(v){
    // 向#log-item-tbody追加日志信息
    if(!v || v.length == 0){
        Info("no more log data");
        // 将more-log-btn禁用
        $('#more-log-btn').prop('disabled', true);
        return;
    }
    var html = '';
    var exists_num = gv.gv_log_data.length;
    html += _GenLogMegHtml(v, exists_num);
    $('#log-item-tbody').append(html);
    // 更新gv.gv_log_data
    gv.gv_log_data.push(...v);
}

function _GenLogMegHtml(v, exists_num=0){
    var html = '';
    for(var i = 0; i < v.length; i++){
        html += `<tr class='log-item log-item-row' log-index='${i + exists_num}'>
        <td class='log-item-col log-item-revision'>${v[i].revision}</td>
        <td class='log-item-col log-item-author'>${v[i].author}</td>
        <td class='log-item-col log-item-date'>${v[i].date}</td>
        <td class='log-item-col log-item-msg'>${v[i].msg}</td>
        </tr>`;
    }
    return html;
}

// 展示所有提交日志
function ShowLogMsg(indexs){
    var html = 'MSG: ';
    for(var i = 0; i < indexs.length; i++){
        var cur_v = gv.gv_log_data[indexs[i]];
        html += `${cur_v.revision} | ${cur_v.author} | ${cur_v.msg.replace(/[;.；。]\s*$/g, '')}; `;
    }
    $('#log-msgs-container').text(html);
}

// copy 关系映射：目标路径 -> {src: 来源路径, copyRev: 复制产生版本}
function _BuildCopyMap(){
    var map = {};
    var logs = gv.gv_log_data || [];
    for(var i = 0; i < logs.length; i++){
        var files = logs[i].files || [];
        var rev = parseInt(logs[i].revision);
        for(var j = 0; j < files.length; j++){
            var f = files[j];
            if(f.copy_from){
                var at = f.copy_from.lastIndexOf('@');
                var src = f.copy_from.substring(0, at);
                if(!map[f.path]){
                    map[f.path] = {src: src, copyRev: rev};
                }
            }
        }
    }
    return map;
}

// 当选择区间跨越 copy 时，返回被双击路径对应的来源/目标端点 {src, dst}；否则返回 null
function _ResolveCopySrc(path, begin, end){
    begin = parseInt(begin);
    end = parseInt(end);
    if(isNaN(begin) || isNaN(end) || begin == end){
        // 单条提交/非区间不涉及跨 copy，无需特殊处理
        return null;
    }
    var map = _BuildCopyMap();
    var src = null, dst = null, copyRev = null;
    if(map[path]){
        dst = path; src = map[path].src; copyRev = map[path].copyRev;
    }else{
        for(var k in map){
            if(map[k].src === path){ dst = k; src = path; copyRev = map[k].copyRev; break; }
        }
    }
    if(!src || !dst) return null;
    // 区间 [begin,end] 跨越 copy：begin-1 在来源、end 在目标
    if(!((begin - 1) < copyRev && copyRev <= end)) return null;
    return {src: src, dst: dst};
}

/**
 * 判断日志文件路径是否与选中路径相关：原路径直接命中，或经任一 copy 关系
 * （把源路径前缀替换为 copy 目标路径，如 /trunk/a.c → /branches/foo/a.c）转换后命中。
 * svn log -v 会列出每条提交的全部变更文件，其中很多与选中路径无关，需据此过滤。
 * @param {string} p 日志中的文件路径（仓库根相对，含项目段）
 * @param {string} cur_path 选中路径（同为仓库根相对）
 * @param {object} copy_map _BuildCopyMap() 的结果
 */
function _IsLogPathRelated(p, cur_path, copy_map){
    if(p === cur_path || p.indexOf(cur_path + '/') === 0){
        return true;
    }
    for(var k in copy_map){
        var src = copy_map[k].src;
        if(p === src || p.indexOf(src + '/') === 0){
            var conv = k + p.substring(src.length);
            if(conv === cur_path || conv.indexOf(cur_path + '/') === 0){
                return true;
            }
        }
    }
    return false;
}

function ShowLogFiles(indexs){
    _log_selected_indexs = indexs.slice();
    // git 提交的文件列表按需加载：收集当前选中行中尚未加载的提交，批量请求一次
    if(_IsGitRepoView()){
        var missing_revisions = [];
        for(var i = 0; i < indexs.length; i++){
            var cur_v = gv.gv_log_data[indexs[i]];
            if(!cur_v){
                continue;
            }
            // 已加载且确实是按当前弹框路径加载的才可复用，避免复用其它目录/文件的过滤结果
            if(cur_v.files !== undefined && cur_v._files_path === _log_dialog_path){
                continue;
            }
            if(_log_commit_files_loading[cur_v.revision]){
                continue;
            }
            _log_commit_files_loading[cur_v.revision] = true;
            missing_revisions.push(cur_v.revision);
        }
        if(missing_revisions.length > 0){
            // 始终使用弹框打开时的路径，保证文件列表与日志列表来自同一目录/文件
            CallSys('get-commit-files', {path:_log_dialog_path, revisions: missing_revisions});
        }
    }
    _RenderLogFiles(indexs);
}

// 文件列表按需加载完成/失败后由后台事件调用
function OnCommitFilesLoaded(v){
    // 只处理当前日志弹框对应路径的结果，丢弃切换路径后返回的过期数据
    if(v && v.path && v.path !== _log_dialog_path){
        return;
    }
    var files_map = (v && v.files) ? v.files : {};
    Object.keys(files_map).forEach(function(rev){
        delete _log_commit_files_loading[rev];
    });
    // 弹框已关闭时忽略结果。这里不能判断 #my-info 的 in 类：bootstrap 的 in 类在淡入
    // 动画（约300ms）后才会加上，而缓存命中时后台几十毫秒就返回，会导致结果被丢弃且
    // 加载标记已清除，界面一直停留在 Loading changed files...
    if(!$('#log-item-container').length){
        return;
    }
    var logs = gv.gv_log_data || [];
    for(var i = 0; i < logs.length; i++){
        if(Object.prototype.hasOwnProperty.call(files_map, logs[i].revision)){
            logs[i].files = files_map[logs[i].revision] || [];
            // 记录这批文件是按哪个路径过滤出来的
            logs[i]._files_path = _log_dialog_path;
        }
    }
    if(_log_selected_indexs.length > 0){
        ShowLogFiles(_log_selected_indexs);
    }
}

function OnCommitFilesFailed(v){
    if(v && v.path && v.path !== _log_dialog_path){
        return;
    }
    var revisions = (v && v.revisions) ? v.revisions : [];
    revisions.forEach(function(rev){
        delete _log_commit_files_loading[rev];
    });
    // 弹框已关闭时忽略结果（不判断 in 类，原因同上）
    if(!$('#log-item-container').length){
        return;
    }
    // 标记为空列表，避免一直显示加载中；具体错误已由后台弹框提示
    var logs = gv.gv_log_data || [];
    for(var i = 0; i < logs.length; i++){
        if(revisions.indexOf(logs[i].revision) !== -1 && logs[i].files === undefined){
            logs[i].files = [];
            logs[i]._files_path = _log_dialog_path;
        }
    }
    if(_log_selected_indexs.length > 0){
        ShowLogFiles(_log_selected_indexs);
    }
}

function _RenderLogFiles(indexs){
    var html = '';
    // 聚合所有已加载的files信息
    var files = [];
    var has_loading = false;
    var is_git = _IsGitRepoView();
    for(var i = 0; i < indexs.length; i++){
        var cur_v = gv.gv_log_data[indexs[i]];
        if(!cur_v){
            continue;
        }
        if(is_git){
            // 只使用按当前弹框路径加载的文件列表，路径不一致视为未加载（会重新请求）
            if(cur_v.files !== undefined && cur_v._files_path === _log_dialog_path){
                files.push(...cur_v.files);
            }else{
                has_loading = true;
            }
        }else if(cur_v.files){
            files.push(...cur_v.files);
        }
    }
    // 去重
    var files_key = {};
    files = files.filter((obj, index) => {
        const str = JSON.stringify(obj);
        var exists = files_key.hasOwnProperty(str);
        files_key[str] = true;
        return !exists;
    });

    // 按弹框路径过滤文件列表：svn log -v 列出的是每条提交的全部变更文件（含与选中路径
    // 无关的文件；pre-copy 提交的路径还位于源分支命名空间），pre-copy 路径经 copy 关系
    // 转换回当前分支路径后再匹配，只保留与选中路径相关的文件（提交列表由 svn log 自身
    // 按路径过滤，无需前端处理）。
    var cur_path = (_log_dialog_path || '').replace(gv.gv_repo_head, '');
    if(cur_path){
        var copy_map = _BuildCopyMap();
        files = files.filter(function(f){
            return _IsLogPathRelated(f.path, cur_path, copy_map);
        });
    }

    // http://git.mine/svn 仓库在 copy 后会在不同分支保留来源文件，需一并列出并支持 diff
    for(var i = 0; i < files.length; i++){
        var copy_from_str = `<span class='log-file-from' title='copy from ${files[i].copy_from}'>${files[i].copy_from}</span>`;
        if(files[i].prop_mods == 'true'){
            var prop_mod = 'P';
            html += `<div class='log-file-item'><span class='log-file-action'>${files[i].action}</span><span class='log-prop-action' title="属性变更">${prop_mod}</span>|<span class='log-file-path'>${files[i].path}</span>${copy_from_str}</div>`;
        }
        // 对于文件夹，只对text_mode进行diff
        var no_diff_class = ""
        if(files[i].text_mods == 'false'){
            no_diff_class = 'not-diff';
        }
        html += `<div class='log-file-item ${no_diff_class}'><span class='log-file-action'>${files[i].action}</span><span class='log-prop-action' title="属性变更"></span>|<span class='log-file-path'>${files[i].path}</span>${copy_from_str}</div>`;
    }
    if(has_loading){
        html += `<div class='log-file-loading'>Loading changed files...</div>`;
    }
    $('#log-file-container').html(html);
    // 双击文件获取文件变更内容
    $(".log-file-item").dblclick(function(){
        var path = $(this).find('.log-file-path').text();
        // 检查节点是否含有no-diff类，如果有则不进行diff
        if($(this).hasClass('not-diff')){
            Info(`skip show diff for dir ${path}`);
            return;
        }
        var action = $(this).find('.log-file-action').text();
        var prop_mod = $(this).find('.log-prop-action').text();
        // 范围为 [begin, end],前包后包
        var begin = null, end=null;
        if(action == 'M'){
            begin = gv.gv_selected_log_version[0];
            end = gv.gv_selected_log_version[1];
        }else if(action == 'A'){
            end = gv.gv_selected_log_version[1];
        }else if(action == 'D'){
            begin = gv.gv_selected_log_version[0];
        }
        if(prop_mod.length > 0){
            // 展示属性变更；属性的跨 copy 对比暂不处理，沿用原路径
            CallSys('get-repo-properties-diff', {path:gv.gv_repo_head+path, begin:begin, end:end});
        }else{
            // 展示文件内容
            // 跨越 copy 时，向后台传来源路径@旧版本与目标路径@新版本，确保两端内容正确可取
            var copy_res = _ResolveCopySrc(path, begin, end);
            var diff_path = path, copy_src = null;
            if(copy_res){
                diff_path = copy_res.dst;
                copy_src = copy_res.src;
            }
            CallSys('get-repo-file-diff', {path:gv.gv_repo_head+diff_path, begin:begin, end:end, copy_src: copy_src ? gv.gv_repo_head+copy_src : null});
        }
    });
    // log-file-item 点击时生成MSG信息
    $(".log-file-item").off('click').on('click', function(){
        // 将条目转换为文本，并在每个子div内容间添加空格
        var msg = '';
        msg += $(this).find('.log-file-action').text() + '   ';
        msg += $(this).find('.log-prop-action').text() + '   ';
        msg += $(this).find('.log-file-path').text() + '   ';
        msg += $(this).find('.log-file-from').text() + '   ';
        $('#log-msgs-container').html('<pre>CHG: ' + msg + '</pre>');
    });
}
