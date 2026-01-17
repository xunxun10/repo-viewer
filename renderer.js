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
            "show-more-repo-log":function(v){
                AppendLogMsg(v);
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