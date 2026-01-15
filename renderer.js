// 页面渲染逻辑
/*
常用判断逻辑:
    是否本地缓存了仓库数据： gv.gv_local_cached
*/

// 保存全局变量
gv = {
    gv_select_node: null,  // 选中的节点的JSON格式数据，非NODE对象 {"id":"j1_2","text":"help","icon":true,"parent":"j1_3","parents":["j1_3","#"],,"children":[],"children_d":[],"data":null,"state":{"loaded":false,"opened":false,"selected":true,"disabled":false},"li_attr":{"id":"j1_2"},"a_attr":{"href":"#","id":"j1_2_anchor"},"original":{"text":"help"}}
    gv_select_node_id: null,
    gv_repo_head: null,  // 仓库根节点, 为实际根节点非逻辑根节点，包含仓库名
    gv_repo_url: '',  // 当前仓库地址
    fixed_version: '',  // 锁定的版本号，如 svn url: xxxx/xxx@1234 中的1234
    gv_tree_cache: {},  // 仓库树缓存, 以不带#的node_id为key，#为根节点
    gv_log_data: null,  // 当前选中节点的提交日志
    gv_selected_log_version: null,  // 当前选中的提交日志版本起始号[begin, end]
    gv_local_cached:false,  // 是否本地缓存仓库数据
    show_files:[],  // 显示的文件列表
}

// 监听后台发来的事件
if(typeof window.electronAPI != 'undefined'){
    window.electronAPI.OnBgErrorMsg((_event, value) => {
        MyModal.Alert("Error: " + value);
    })
    window.electronAPI.OnSysCall((_event, msg) => {
        let value = msg.data;
    
        console.debug("handle from sys: " + msg.type + ' ' + JSON.stringify(value).substring(0, 100))
    
        var ProcessSysCall = {
            "info-on-bg":function(v){
                Info(v);
            },
            "show-cache-status":function(v){
                g_status.br_name = v.br_name;
                g_status.up_time = v.up_time;
                ShowStatus();
            },
            "modal-to-web":function(v){
                // 从后台发来的消息，弹出模态框
                MyModal.Alert("<div class='ModalInfoDiv' id='modal-to-web-div'>" + value + "</div>", null, 800);
                $("#modal-to-web-div").html(value);
            },
            "open-password-panel":function(v){
                // 从后台发来的消息，弹出密码输入框
                OpenPasswordPanel(v);
            },
            "open-settings-panel":function(v){
                // 打开编辑界面
                OpenSettingsPanel(v);
            },
            "show-saved-repo-list":function(v){
                // 显示保存的仓库列表
                ShowSavedRepoList(v);
            },
            "init-accessed-repo-list":function(v){
                // 初始化访问过的仓库列表
                InitAccessedRepoList(v);
            },
            "edit-accessed-repo-list":function(v){
                // 编辑访问过的仓库列表
                EditAccessedRepoList(v);
            },
            "show-repo-tree":function(v){
                UpdateView(v);
            },
            "save-repo-url-ok":function(v){
                Info(`save repo url ok: ${v.nickname}:${v.repo_url}`);
                // 刷新保存的仓库列表
                CallSys('get-saved-repo-list');
            },
            "delete-saved-repo-ok":function(v){
                Info(`delete saved repo ok: ${v}`);
                // 刷新保存的仓库列表
                CallSys('get-saved-repo-list');
            },
            "show-repo-log":function(v){
                ShowLogDialog(v);
            },
            "show-repo-file-diff":function(v){
                // {pre: 'xxx', new: 'xxx'}
                ShowFileDiff(v.pre, v.new, v.title);
            },
            "show-repo-properties":function(v){
                ShowpropertiesDialog(v);
            },
            "show-repo-properties-diff":function(v){
                ShowDiff(v.pre, v.new, v.title);
            },
        }
        ProcessSysCall[msg.type](value);
    })
}

// 向后台发送消息
function CallSys(type, obj=null){
    var msg = {type:type, data:obj}

    console.debug("send to sys: " + type + ' ' + JSON.stringify(msg).substring(0, 100))

    if(typeof window.electronAPI != 'undefined'){
        window.electronAPI.CallSys(msg);
    }
}

function Info(str){
    $('#bottom-info').text(MyDate.Now() + " " + str);
}

var g_status = {br_name:"", up_time:""};
function ShowStatus(str){
    if(str){
        $('#bottom-status').text(str);
    }else{
        // 将 2025-03-22T14:51:55.776Z 格式时间转换为localtime
        var time = '';
        if(g_status.up_time){
            var date = new Date(g_status.up_time);
            var time = MyDate.GetTime4Str(date);
        }
        $('#bottom-status').text(`${time} ${g_status.br_name.slice(0,38)}`);
    }
}

function ShowError(str){   
    MyModal.Alert("Error: " + str);
    // Info("Error: " + str);
}

function InitSize(){
    $(".board").css('height', ($(window).height() - 90) + 'px');
    $("#res-detail").css('max-height', ($(window).height() - 120) + 'px');
}

function UpdateView(repo){
    if(gv.gv_select_node){
        gv.gv_tree_cache[gv.gv_select_node.id] = repo;
    }else{
        // 首次访问，设置根节点信息
        gv.gv_tree_cache['#'] = repo;
        // 如果tree.local_cached有值，则设置为本地缓存状态
        gv.gv_local_cached = repo.tree.local_cached;
    }
    // 为url中除去path的部分
    gv.gv_repo_head = repo.tree.repo_root;
    // 更新repo-url
    UpdateRepoUrl(repo.url);
    // 更新repo-tree
    UpdateRepoTree(repo);
    // 更新repo-files
    UpdateRepoFiles(repo.tree);
}

/**
 * 更新访问根地址到全局变量
 * @param {*} repo_url 
 */
function UpdateRepoUrl(repo_url){
    if ($("#repo-url").val() == ''){
        $("#repo-url").val(repo_url);
        // gv_repo_url为不包含版本号的svn路径,需要注意git路径中可能包含@符号
        // 如果链接末尾包含@数字，则需要去掉@符号后的部分
        if (/@\d+$/.test(repo_url)) {
            gv.gv_repo_url = repo_url.split('@')[0];
            // 获取@后的数字，并去除末尾可能存在的/
            gv.fixed_version = repo_url.split('@')[1];
        } else {
            gv.gv_repo_url = repo_url;
        }

        // 获取路径的最后三个部分作为repo名称,如果长度大于25字符，则取最后一个部分
        var url_parts = gv.gv_repo_url.split('/');
        var repo_name = url_parts.slice(-3).join('/');
        if (repo_name.length > 25){
            repo_name = url_parts.slice(-1);
        }
        $("#repo-name").text(repo_name);
    }
}

/**
 * jstree不显示文字前的图标，并增加一个根节点
 * @param {Object} repo
 **/
function _CreateRepoTreeNode(repo){
    return {
        'core' : {
            'data' : repo.tree.dirs,
            'themes' : {
                'icons' : false,
                'dots' : true,
            },
            'dblclick_toggle' : false, // 双击不展开
            'check_callback' : true,  // 允许修改节点
            'multiple': false,  // 不允许多选
        },
        'plugins': ['contextmenu'],
        'contextmenu': {
            'items': function (node) {
                return {
                    // 自定义菜单项
                    "showlog": {
                        "separator_before": false,
                        "separator_after": false,
                        "label": "show log",
                        "action": function (obj) {
                            // 菜单点击逻辑，obj.reference（节点的 DOM 元素），也可以直接使用node变量
                            $('.repo-file.click-node').removeClass('active');
                            SetSelectNode(node)
                            CallSys('get-repo-log', _GetSelPath());
                        }
                    },
                    // 添加刷新菜单
                    "refresh": {
                        "separator_before": false,
                        "separator_after": false,
                        "label": "refresh",
                        "action": function (obj) {
                            CallSys("refresh-repo", gv.gv_repo_url);
                            // 菜单点击逻辑，obj.reference（节点的 DOM 元素），也可以直接使用node变量
                            _RefreshNodeChildren(node);
                        }
                    },
                    "showproperties": {
                        "separator_before": false,
                        "separator_after": false,
                        "label": "show properties",
                        "action": function (obj) {
                            // 菜单点击逻辑，obj.reference（节点的 DOM 元素），也可以直接使用node变量
                            $('.repo-file.click-node').removeClass('active');
                            SetSelectNode(node)
                            CallSys('get-repo-properties', _GetSelPath());
                        }
                    },
                    // 收缩父节点
                    "collapse parent": {
                        "separator_before": false,
                        "separator_after": false,
                        "label": "collapse parent",
                        "action": function (obj) {
                            var parent_node = $('#repo-tree').jstree('get_node', node.parent);
                            // 选中并关闭父节点
                            $('#repo-tree').jstree('select_node', parent_node, true);
                            $('#'+node.parent + '>.jstree-anchor').click();
                            $('#repo-tree').jstree('close_node', parent_node);
                        }
                    },
                    // 每次展开都会刷新子节点信息，因此不需要刷新菜单
                    // 其他菜单项...
                };
            }
        }
    }
}

// 将包含{revision, author, date, msg}的数组转换为html字符串
function ShowLogDialog(v){
    var html = `<div id='log-item-container'><table><thead><tr class='log-item log-item-head'>
    <th class='log-item-col log-item-revision'>Revision</th>
    <th class='log-item-col log-item-author'>Author</th>
    <th class='log-item-col log-item-date'>Date</th>
    <th class='log-item-col log-item-msg'>Message</th>
    </tr></thead>`
    html += '<tbody>';
    for(var i = 0; i < v.length; i++){
        html += `<tr class='log-item log-item-row' log-index='${i}'>
        <td class='log-item-col log-item-revision'>${v[i].revision}</td>
        <td class='log-item-col log-item-author'>${v[i].author}</td>
        <td class='log-item-col log-item-date'>${v[i].date}</td>
        <td class='log-item-col log-item-msg'>${v[i].msg}</td>
        </tr>`;
    }
    html += '</tbody></table></div>';
    gv.gv_log_data = v;
    // 显示修改的文件列表 v.files:[{path, action}]
    html += `<div id='log-file-container'></div><div id='log-msgs-container'></div>`;

    MyModal.Info(html, `${_GetSelPath()} commit log`);

    var _last_shift_click = null;
    // 设置点击事件，可按住shift+鼠标同时选中多条
    $(".log-item-row").mousedown(function(e){
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
            ShowLogMsgs(active_index);
            ShowLogFiles(active_index);
            // console.log(`select indexs: ${active_index}`);  // debug console
        }else{
            // 单击事件
            $(".log-item-row").removeClass('active');
            $(this).addClass('active');
            var selected_log_vision = $(this).find('.log-item-revision').text();
            gv.gv_selected_log_version = [selected_log_vision, selected_log_vision];
            var active_index = [$(this).index()];
            ShowLogMsgs(active_index);
            ShowLogFiles(active_index);
            // console.log(`select indexs: ${active_index}`);  // debug console

            _last_shift_click = cur;
        }
    });

    // 默认点击第一行
    if(v.length > 0){
        $(".log-item-row").first().trigger({
            type: 'mousedown',
            button: 0 // 0 表示鼠标左键
        });
    }
}

// 展示所有提交日志
function ShowLogMsgs(indexs){
    var html = 'MSG: ';
    for(var i = 0; i < indexs.length; i++){
        var cur_v = gv.gv_log_data[indexs[i]];
        html += `${cur_v.msg.replace(/[;.；。]\s*$/g, '')}; `;
    }
    $('#log-msgs-container').text(html);
}

function ShowLogFiles(indexs){
    var html = '';
    // 聚合所有files信息
    var files = [];
    for(var i = 0; i < indexs.length; i++){
        var cur_v = gv.gv_log_data[indexs[i]];
        if (cur_v.files) {
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

    // 不包含仓库根节点的路径信息
    var cur_path = _GetSelPath().replace(gv.gv_repo_head, '');
    //console.log('cur_path: ' + cur_path + "\nrepo_head:" + gv.gv_repo_head);   // TODO debug
    for(var i = 0; i < files.length; i++){
        // 跳过不包含当前路径的文件
        if(files[i].path.indexOf(cur_path) == -1){
            console.log(`skip file ${files[i].path} not in ${cur_path}`);  // debug console
            continue;
        }
        /*// 跳过kind为dir并且prop_mods为false并且没有copyfrom属性值的文件夹
        if(files[i].kind == 'dir' && files[i].prop_mods == 'false' && (!files[i].copy_from)){
            continue;
        }*/
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
            // 展示属性变更
            CallSys('get-repo-properties-diff', {path:gv.gv_repo_head+path, begin:begin, end:end});
        }else{
            // 展示文件内容
            CallSys('get-repo-file-diff', {path:gv.gv_repo_head+path, begin:begin, end:end});
        }
    });
}


function ShowDiff(pre_content, cur_content, title="Diff"){
    var color = '', span = null;

    var display = $("<pre id='diff-info'></pre>");

    //var diff = Diff.diffChars(pre_content, cur_content);
    //var diff = Diff.diffWords(pre_content, cur_content);
    var diff = Diff.diffLines(pre_content, cur_content);
    var fragment = document.createDocumentFragment();
    
    diff.forEach(function(part){
        // green for additions, red for deletions, grey for common parts
        color = part.added ? 'green' : part.removed ? 'red' : '';
        span = document.createElement('span');
        if(color == ''){
            span.appendChild(document.createTextNode(part.value));
        }else{
            // 设置class
            span.className = 'diff-span ' + color;
            // 设置内容，需要注意对换行符进行处理，避免显示不出来，替换为span
            var lines = part.value.split(/\r?\n/);
            for(var i = 0; i < lines.length; i++){
                var cur_line = lines[i];
                if(cur_line == ''){  // 空行
                    // 最后一行不能加
                    if(i >= lines.length-1){
                        break;
                    }
                    var zwc_ele = document.createElement("span");
                    zwc_ele.className = 'diff-line-break';
                    span.appendChild(zwc_ele);
                }else{
                    span.appendChild(document.createTextNode(cur_line));
                }
                if(i < lines.length-1){
                    span.appendChild(document.createTextNode('\n'));
                }
            }
        }
        fragment.appendChild(span);
    });

    display.append(fragment);
    MyModal.Info(display, title, '1000px', '600px', 'diff-modal');

    // 设置跳转到上一个及下一个变更的位置的按钮
    var pre_btn = $("<button class='btn btn-default diff-pre-btn' title='前一个变更'><span class='glyphicon glyphicon-chevron-up'></span></button>");
    var next_btn = $("<button class='btn btn-default diff-next-btn' title='后一个变更'><span class='glyphicon glyphicon-chevron-down'></button>");
    pre_btn.click(()=>{
        var cur_span_parent = $("#diff-info");
        var cur_span_parent_scroll_top = cur_span_parent.scrollTop();
        var find_flag = false;
        // 倒序遍历#diff-info内的span元素
        $($("#diff-info .diff-span").toArray().reverse()).each(function(index, ele_dom){
            // 遍历#diff-info内的span元素，找到位于可视区域的前一个span元素
            var cur_span = $(ele_dom);
            // 相对于可视区域的位置
            var cur_span_top = cur_span.position().top;
            if(cur_span_top < 0){
                var new_pos = cur_span_parent_scroll_top + cur_span_top - 30;
                cur_span_parent.scrollTop(new_pos);
                find_flag = true;
                return false;
            }
        });
        if(!find_flag){
            // 提示已无数据
            Info("已到顶");
        }
    });
    next_btn.click(()=>{
        var cur_span_parent = $("#diff-info");
        var cur_span_parent_scroll_top = cur_span_parent.scrollTop();
        var find_flag = false;
        // 倒序遍历#diff-info内的span元素
        $("#diff-info .diff-span").each(function(index, ele_dom){
            // 遍历#diff-info内的span元素，找到位于可视区域的前一个span元素
            var cur_span = $(ele_dom);
            // 相对于可视区域的位置
            var cur_span_top = cur_span.position().top;
            if(cur_span_top > 0){
                var new_pos = cur_span_parent_scroll_top + cur_span_top - 30;
                // 跳过当前视窗内的元素
                if(cur_span_top < cur_span_parent.height()){
                    return; // continue
                }
                cur_span_parent.scrollTop(new_pos);
                find_flag = true;
                return false;
            }
        });
        if(!find_flag){
            // 提示已无数据
            Info("已到底");
        }
    });
    display.append(pre_btn);
    display.append(next_btn);

    // 添加拷贝之前之后的内容按钮
    var pre_copy_btn = $("<button class='btn btn-default diff-pre-copy-btn' title='拷贝旧版本数据'><span class='glyphicon glyphicon-file'> </span></button>");
    pre_copy_btn.click(()=>{
        MyOs.CopyTextToClipboard(pre_content);
    });
    display.append(pre_copy_btn);
}

function ShowFileDiff(pre_content, new_content, title){
    ShowDiff(pre_content, new_content, title);
}

function ShowpropertiesDialog(v){
    var html = `<div id='properties-item-container'><table><thead><tr class='properties-item properties-item-head'>
    <th class='properties-item-col properties-item-key'>Key</th>
    <th class='properties-item-col properties-item-value'>Value</th>
    </tr></thead>`
    html += '<tbody>';
    // 遍历v的keys，生成html
    for(var key in v){
        html += `<tr class='properties-item properties-item-row'>
        <td class='properties-item-col properties-item-key'>${key}</td>
        <td class='properties-item-col properties-item-value'><pre>${v[key]}</pre></td>
        </tr>`;
    }
    html += '</tbody></table></div>';
    MyModal.Info(html, `${_GetSelPath()} properties`);
}

function SetSelectNode(node){
    // 记录下点击的节点
    gv.gv_select_node = node;
    gv.gv_select_node_id = "#" + node.id;
}
function ClearSelectNode(){
    gv.gv_select_node = null;
    gv.gv_select_node_id = null;
}
// 返回当前节点或文件的全路径,包括 repo_url root + file_path
function _GetSelPath(node = null){
    if(node){
        var cur_node = node;
    }else{
        var cur_node = gv.gv_select_node;
    }
    var path = "";
    if(cur_node){
        path = cur_node.text + '/';
        while(cur_node.parent && cur_node.parent != '#'){
            cur_node = $('#repo-tree').jstree('get_node', "#" + cur_node.parent);
            path = cur_node.text + '/' + path;
        }
    }
    // 如果有选择文件需要加上文件路径
    var select_file_node = $('.repo-file.click-node.active');
    if(select_file_node.length > 0){
        path += $('.file-name', select_file_node).text();
    }
    // 如果gv.gv_repo_url末尾有'/'，则去掉
    if(gv.gv_repo_url.slice(-1) == '/'){
        gv.gv_repo_url = gv.gv_repo_url.slice(0, -1);
    }
    if(path != ''){
        path = gv.gv_repo_url + '/' + path;
    }else{
        path = gv.gv_repo_url;
    }
    // 去除路径末尾的'/'
    if(path.slice(-1) == '/'){
        path = path.slice(0, -1);
    }
    return path;
}

// 根据url获取分支名，分支名为branches或者tags下的文件夹名或者master或者trunk
function _GetBrName(repo_file_url){
    // 分解URL路径部分
    var parts = repo_file_url.split('/');
    
    // 查找branches或tags的位置
    var branchesIndex = parts.indexOf('branches');
    var tagsIndex = parts.indexOf('tags');
    
    // 如果找到branches
    if(branchesIndex !== -1 && branchesIndex + 1 < parts.length) {
        return parts[branchesIndex + 1];
    }
    
    // 如果找到tags
    if(tagsIndex !== -1 && tagsIndex + 1 < parts.length) {
        return parts[tagsIndex + 1];
    }
    
    // 检查是否有trunk
    if(parts.includes('trunk')) {
        return 'trunk';
    }
    
    return 'master'; // 默认分支名
}

// 如果当前repo使用缓存，并且当前选中节点与前一节点分支名不同，则强制刷新
function _NeedRefresh(pre_node, new_node){
    //gv.gv_select_node
    if(gv.gv_local_cached && pre_node){
        var pre_url = _GetSelPath(pre_node);
        var new_url = _GetSelPath(new_node);
        
        var cur_branch = _GetBrName(pre_url);
        var new_branch = _GetBrName(new_url);

        return cur_branch != new_branch;
    }
}

function _AddRepoTreeEvent(tree_jq_obj){
    tree_jq_obj.on("ready.jstree", function () {
        // 设置点击文字时触发点击事件
        tree_jq_obj.on("click.jstree", ".jstree-anchor", function (e) {
            var node = $('#repo-tree').jstree('get_node', $(this).closest('.jstree-node'));  // 获取包含该文字的JSON数据
            var pre_node = gv.gv_select_node;
            // 展开子节点
            SetSelectNode(node);
            // 只在关闭状态下获取新数据并触发展开
            if(!node.state.opened){
                $('#repo-tree').jstree('toggle_node', node);
            }else{
                if (_NeedRefresh(pre_node, node)){
                    // 如果当前节点已展开，并且已有子节点则刷新子节点
                    _RefreshNodeChildren(node);
                }
            }
            // 点击时更新files信息
            if(gv.gv_tree_cache[node.id]){
                UpdateRepoFiles(gv.gv_tree_cache[node.id].tree);
            }
            // 清除文件选择
            $('.repo-file.click-node').removeClass('active');
            // 展示当前选择路径
            Info(_GetSelPath());
        });

        // 展开时获取子节点
        $('#repo-tree').on('before_open.jstree', function (e, data) {
            var node = data.node;
            _RefreshNodeChildren(node);
        });

        // 添加右键菜单
        tree_jq_obj.on("contextmenu.jstree", function (e, data) {
            var node = $('#repo-tree').jstree('get_node', e.target);
            SetSelectNode(node);
            $('#repo-tree').jstree('select_node', node);
            $('#repo-tree').jstree('show_contextmenu', node);
        });

        /** 设置选择事件
        $('#repo-tree').on("select_node.jstree", function (e, data) {
            gv.gv_select_node = data.node;
        }); */
    });
}

// 刷新节点的子节点信息
function _RefreshNodeChildren(node){
    SetSelectNode(node);
    // 设置节点选中，但不触发选中事件
    $('#repo-tree').jstree('select_node', node, true);

    // console.log("open node:" + JSON.stringify(node))  # debug console
    // 遍历节点的所有父节点，拼接路径
    var cur_node = node;
    var path = cur_node.text;
    while(cur_node.parent && cur_node.parent != '#'){
        cur_node = $('#repo-tree').jstree('get_node', "#" + cur_node.parent);
        path = cur_node.text + '/' + path;
    }
    CallSys('get-repo-node', gv.gv_repo_url + '/' + path);
}


// 更新整个repo树
function UpdateRepoTree(repo){
    
    // repo.tree结构：{base: 'xxx', path='xxx', dirs: [{text: 'xxx'}], , files: [{text: 'xxx'}]}
    // js tree data 需要的结构：[{text: 'xxx', children: [{text: 'xxx'}]}]
    if (gv.gv_select_node){
        //console.log('update repo tree: ' + gv.gv_select_node_id);  // debug console
        selected_node_id = gv.gv_select_node_id;

        // 如果有选中的节点，则清除原节点下的子节点数据并将数据追加到节点下

        // 清除所有子节点
        var children =  $('#repo-tree').jstree(true).get_node(selected_node_id).children;
        //console.log('delete node '+selected_node_id+':' + JSON.stringify(children));
        $('#repo-tree').jstree(true).delete_node(children);

        // 添加新的子节点，目前不支持通过数组方式一次添加多个节点
        /*if(repo.tree.dirs.length > 0){
            console.log('new node to '+selected_node_id+':' + JSON.stringify(repo.tree.dirs));  // debug console
            $(selected_node_id).jstree(true).create_node(selected_node_id, repo.tree.dirs, 'last', function (e) { true; }, true);
        }*/
        if(repo.tree.dirs.length > 0){
            var max_node = 100;
            // 当子节点超过max_node个时，只展示按照子节点date数据排序的最后max_node个节点
            if(repo.tree.dirs.length > max_node){
                // 如果子节点超过max_node个，则打印提示
                console.log(`too many nodes, only show last ${max_node} nodes order by commit date`)
                Info(`too many nodes, only show last ${max_node} nodes order by commit date`);

                // 按照子节点date数据排序并获取最后max_node个节点
                var sorted_dirs = repo.tree.dirs.sort(function(a, b){
                    return a.date > b.date ? 1 : -1;
                });
                var show_dirs = sorted_dirs.slice(-max_node);
                // 将show_dirs还原为按照text属性排序
                show_dirs.sort(function(a, b){
                    return a.text > b.text ? 1 : -1;
                });
            }else{
                var show_dirs = repo.tree.dirs;
            }
            for (var i = 0; i < show_dirs.length; i++) {
                $(selected_node_id).jstree(true).create_node(selected_node_id, show_dirs[i], 'last', function (e) { true; }, true);
            }
        }

        _AddRepoTreeEvent($(selected_node_id));
    }else{
        console.log('update whole repo tree: #');  // debug console
        // 销毁原树并创建新树
        $('#repo-tree').jstree('destroy');
        $('#repo-tree').jstree(_CreateRepoTreeNode(repo));
        _AddRepoTreeEvent($('#repo-tree'));
    }
    
}

function EditAccessedRepoList(repo_list){
    // 将list转为字符串放入textarea中进行编辑，使用 MyModal 进行弹框确认
    var html = `<textarea id='accessed-repo-list' class='modal-textarea' style='width: 100%;height: 90%;padding: 10px;'>`;
    html += repo_list.join('\n');
    html += `</textarea>`;
    MyModal.Confirm(html, function(){
        var repo_list = $('#accessed-repo-list').val().split('\n');
        // 去除空行
        repo_list = repo_list.filter(function(value, index, arr){
            return value.trim() != '';
        });
        CallSys('save-accessed-repo-list', repo_list);
    }, null, null, "Edit accessed repo info");
}

function ShowSavedRepoList(repo_list){
    var container = $('#repos');
    var html = `<div id='saved-repo-list'>`;
    var repo_val_list = [];
    for(var i = 0; i < repo_list.length; i++){
        var url = repo_list[i]['repo'];
        var nickname = repo_list[i]['nickname'];
        if (! nickname){
            // 获取url简写，取branches,trunk,tags之前的路径的前三个字母，如果没有匹配则取最后一截路径的前三个字母，并转为大写
            var short_url = url.split('/branches/')[0].split('/trunk')[0].split('/tags/')[0];
            short_url = short_url.replace(/\/$/, '').split('/').pop().slice(0, 3).toUpperCase();
            nickname = short_url;
        }
        html += `<div class='saved-repo-item' id='saved-repo-${i}' title="${url}" url="${url}">${nickname}</div>`;
        repo_val_list.push(url);
    }
    html += `</div>`;
    container.html(html);
    // 点击后设置repo_url并调用access-btn
    $(".saved-repo-item").click(function(){
        var repo_url = $(this).attr('url');
        $('#repo-url').val(repo_url);
        $('#access-btn').click();
    });
    // 增加删除菜单
    $.contextMenu({
        // define which elements trigger this menu
        selector: "#saved-repo-list .saved-repo-item",
        // define the elements of the menu
        items: {
            delete: { name: "delete", callback: function(key, opt){
                var cur = opt.$trigger;
                var repo_url = cur.attr('url');
                CallSys('delete-saved-repo', repo_url);
            }},
        }
    });
}

function InitAccessedRepoList(repo_list){    
    // 设置地址自动补全
    MyJQueryUi.AutoComplete("#repo-url", repo_list, select_fun = function(value){
        $("#access-btn").click();
    }, max_height=260);
}


function _ToggleActive(selector, active_func=null){
    $(selector).click(function(){
        cur = $(this);
        if(cur.hasClass('active')){
            cur.removeClass('active');
        }else{
            $(selector).removeClass('active');
            cur.addClass('active');
            if(active_func){
                active_func(cur);
            }
        }
    });
}

// 设置saved-repo-item选中状态
function ToggleSavedRepoItem(repo_url){
    // 遍历所有 saved-repo-item active，如果url属性是repo_url的子集则设置为选中状态
    $(".saved-repo-item").each(function(){
        var cur = $(this);
        cur.removeClass('active');
        if(cur.attr('url').indexOf(repo_url) != -1){
            cur.addClass('active');
        }
    });
}

function BindEvent(){
    // settings-btn点击后，从后台获取访问历史进行编辑
    $('#settings-btn').click(function(){
        CallSys('edit-accessed-repo-list');
    });

    // access-btn点击后，显示repo-url对应的具体数据
    $('#access-btn').click(function(){
        var repo_url = $('#repo-url').val();
        if(repo_url == ''){
            ShowError('Please input repo url');
            return;
        }
        // 如果路径末尾有'/'，则去掉
        if(repo_url.slice(-1) == '/'){
            repo_url = repo_url.slice(0, -1);
        }
        // 重置全局变量
        ClearSelectNode();
    
        CallSys('get-repo-tree', repo_url);
        $("#repo-url").val("");

        // 设置保存按钮选中状态 saved-repo-item
        ToggleSavedRepoItem(repo_url);
    });

    // save-btn点击后，保存repo-url到后台
    $('#save-btn').click(function(){
        var repo_url = $('#repo-url').val();
        if(repo_url == ''){
            ShowError('Please input repo url');
            return;
        }
        
        var short_url = repo_url.split('/branches/')[0].split('/trunk')[0].split('/tags/')[0];
        short_url = short_url.replace(/\/$/, '').split('/').pop().slice(0, 3).toUpperCase();

        // 弹框输入仓库别名
        var html = `<table><tr>
        <td class="modal-label">请输入仓库别名:</td>
        <td><input type='text' id='repo-nickname-input' class='modal-input' title='建议3字符' value='${short_url}'/></td>
        </tr></table>`;
        MyModal.Confirm(html, ok_fun=function(){
            var nickname = $('#repo-nickname-input').val();
            CallSys('save-repo-url', {repo_url:repo_url, nickname:nickname});
        }, cancele_fun=null, pre_btn_obj=null, title='Save repo info to common use');
    });

    $("#repo-name").click(function(){
        // 显示root file信息
        if(gv.gv_tree_cache['#']){
            UpdateRepoFiles(gv.gv_tree_cache['#'].tree);
        }
        // 取消jstree节点选择
        $('#repo-tree').jstree('deselect_all');
        ClearSelectNode();
        Info(_GetSelPath());
    });

    // url获得焦点时选中整个路径，输入enter时触发access-btn
    $("#repo-url").focus(function(){
        $(this).select();
    }).keydown(function(e){
        if(e.keyCode == 13){
            $('#access-btn').click();
        }
    });

    // 设置文件排序事件
    SetFileHeadEvent();

    // $('#repo-tree').on('changed.jstree', function (e, data) {
    //     var i, j, r = [];
    //     for(i = 0, j = data.selected.length; i < j; i++) {
    //         r.push(data.instance.get_node(data.selected[i]).text);
    //     }
    //     $('#res-detail').html('Selected: ' + r.join(', '));
    // }).jstree();

}

function BindFilePathCopyHotKey(ele_id){
    // ctrl+c时获取路径信息并保存到剪贴板, 只有鼠标悬浮于jstree或者repo-file上时才能触发.注意绑定的元素需要设置tabindex属性
    $(ele_id).keydown(function(e){
        if(e.ctrlKey && e.keyCode == 67){
            var path = _GetSelPath();
            MyOs.CopyTextToClipboard(path);
            Info("copy to clipboard: " + path);
        }
    });
}
// 快捷键设置
function BindHotKey(){
    BindFilePathCopyHotKey("#tree-container");
}

$(function(){
    // 从后台获取初始数据
    CallSys('get-last-repo-tree');
    CallSys('get-saved-repo-list');
    CallSys('init-accessed-repo-list');

    InitSize();
    
    BindEvent();

    BindHotKey();
    
});

$(window).resize(function(){
    InitSize();
});