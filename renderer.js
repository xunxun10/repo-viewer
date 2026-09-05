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
            // ==================== 分支比对 ====================
            "show-branch-list":function(v){
                ShowBranchCompareDialog(v);
            },
            "show-branch-compare":function(v){
                RenderBranchCompareList(v);
            },
            "show-branch-file-diff":function(v){
                ShowBranchFileDiff(v);
            },
            "show-action-logs":function(v){
                ShowActionLogs(v);
            },
            "batch-update-completed":function(v){
                // 批量更新完成，重置按钮并刷新日志内容
                $('#batch-update-btn').prop('disabled', false);
                $('#batch-update-status').hide();
                _RenderActionLogTable(v);
                Info('Batch update completed');
            },
            "show-recent-repos":function(v){
                ShowRecentRepos(v);
            },
            // ==================== 仓库文件搜索 ====================
            "show-search-results":function(v){
                // 搜索结果回显到搜索对话框
                ShowSearchResultsInDialog(v);
            },
            "svn-cache-status":function(v){
                // SVN 缓存状态
                OnSvnCacheStatus(v);
            },
            "svn-checkout-failed":function(v){
                // SVN checkout 失败时重置搜索状态
                OnSvnCheckoutFailed(v);
            },
            // ==================== 跨仓库搜索 ====================
            "open-all-repo-search":function(v){
                OpenAllRepoSearchDialog();
            },
            "show-all-repo-search-results":function(v){
                ShowAllRepoSearchResults(v);
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
        var time = '';
        var branch = g_status.br_name;
        if(g_status.up_time){
            var date = new Date(g_status.up_time);
            var time = MyDate.GetDateStr(date, true);
            var maxBrLen = 45 - time.length;
            branch = branch.slice(0, maxBrLen);
        }
        $('#bottom-status').text(`${time} ${branch}`);
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

/**
 * 显示笔记差异
 * @param {*} pre_content 前一个版本的内容
 * @param {*} cur_content 当前版本的内容
 * @param {*} diff_mode 差异模式，line表示按行对比，word表示按单词对比，char表示按字符对比，默认按行对比
 */
function ShowDiff(pre_content, cur_content, title='diff info', diff_mode='line'){
    var color = '', span = null;

    // 如果内容相同则弹框提示
    if(pre_content === cur_content){
        MyModal.Alert("内容相同，无差异");
        return;
    }

    // 使用可滚动的两列布局：左侧行为行号，右侧为内容；整体容器保留 id='diff-info' 以兼容滚动/跳转逻辑
    var display = $("<div id='diff-info' class='diff-view'></div>");
    var gutter = document.createElement('div');
    gutter.className = 'diff-gutter';
    var content = document.createElement('div');
    content.className = 'diff-content';

    // 行号计数器：针对最终版本（cur_content）所有非-removed 的行都参与计数（包括不变的数据）
    var finalLineNo = 1;

    var diff;
    // 如果cur_content末尾不是换行符，则两边各增加一个换行符
    if(!/^\r?\n$/.test(cur_content)){
        pre_content += '\n';
        cur_content += '\n';
    }
    if(diff_mode == 'char'){
        diff = Diff.diffChars(pre_content, cur_content);
    }else if(diff_mode == 'word'){
        diff = Diff.diffWords(pre_content, cur_content);
    }else{
        diff = Diff.diffLines(pre_content, cur_content);
    }
    // 会话级保存设置（内存中），每次打开比较界面生效但不写入磁盘
    if(typeof window._diff_saved_settings === 'undefined') window._diff_saved_settings = {};
    var _diff_saved_settings = window._diff_saved_settings;

    // render 函数：根据 filterRegexStr 与 showOnlyChanges 设置渲染内容
    function render(filterRegexStr, showOnlyChanges, excludeRegexStr){
        // 清空容器
        gutter.innerHTML = '';
        content.innerHTML = '';

        // 预编译正则（如果有）
        var re = null;
        if(filterRegexStr && filterRegexStr.length > 0){
            try{
                re = new RegExp(filterRegexStr);
            }catch(e){
                // 如果正则非法，则忽略过滤
                re = null;
            }
        }

        // 预编译排除正则（如果有）
        var excludeRe = null;
        if(excludeRegexStr && excludeRegexStr.length > 0){
            try{
                excludeRe = new RegExp(excludeRegexStr);
            }catch(e){
                // 如果正则非法，则忽略过滤
                excludeRe = null;
            }
        }

        // 行号计数器：针对最终版本（cur_content）所有非-removed 的行都参与计数（包括不变的数据）
        var localFinalLineNo = 1;
        var linePrefix = '';  // 存储同行内删除数据前的非删除内容，因为一行可能包含多个part

        diff.forEach(function(part){
            var partColor = part.added ? 'green' : part.removed ? 'red' : '';
            var lines = part.value.split(/\r?\n/);
            // Check if the part ends with a newline - if not, the last element in lines is not a complete line
            var partEndsWithNewline = /\r?\n$/.test(part.value);
            if(lines.length > 1 && partEndsWithNewline){
                lines.pop(); // Remove the empty string after the final newline
            }
            var isRemoved = !!part.removed;

            for(var i = 0; i < lines.length; i++){
                var cur_line = lines[i];

                // 判断当前行是否含有换行符（以换行符结束）
                var isLineEnd = (i < lines.length - 1) || partEndsWithNewline;
                var isEmptyLineNo =  false;

                // 当前行在最终版本的行号
                var currentLineNo = null;
                // 删除行不显示行号，如果是删除行但linePrefix有值，也需要显示行号（linePrefix表示删除行前还有非删除的内容）
                if(isLineEnd){
                    if (!isRemoved || linePrefix !== ''){
                        currentLineNo = localFinalLineNo;
                        localFinalLineNo++;
                    }else{
                        isEmptyLineNo = true;
                    }
                }

                // 过滤与"仅显示变更"判定（注意：即便被过滤，行号仍按未过滤数据计算）
                var shouldRender = true;
                if(re){
                    // 对文本进行匹配（对 removed/added/unchanged 均使用该文本）
                    shouldRender = re.test(cur_line);
                }
                // 排除正则过滤：满足排除正则的行不显示
                if(excludeRe && excludeRe.test(cur_line)){
                    shouldRender = false;
                }
                if(showOnlyChanges && partColor === ''){
                    shouldRender = false;
                }

                if(!shouldRender){
                    // 即不渲染该行，但如果是非 removed 且是完整行，则行号计数已增加
                    continue;
                }

                if(isLineEnd){
                    // gutter: 只有非-removed 的完整行显示行号，removed 或不完整行显示占位
                    var gutterLine = document.createElement('div');
                    gutterLine.className = 'diff-gutter-line';
                    if(!isEmptyLineNo){
                        gutterLine.appendChild(document.createTextNode(currentLineNo));
                    }else{
                        gutterLine.appendChild(document.createTextNode(''));
                    }
                    gutter.appendChild(gutterLine);
                }

                if(partColor === ''){
                    content.appendChild(document.createTextNode(cur_line));
                }else{
                    var inner = document.createElement('span');
                    inner.className = 'diff-span ' + partColor;
                    if(cur_line === ''){
                        var zwc_ele = document.createElement('span');
                        zwc_ele.className = 'diff-line-break';
                        inner.appendChild(zwc_ele);
                    }else{
                        inner.appendChild(document.createTextNode(cur_line));
                    }
                    content.appendChild(inner);
                }
                // Add line break after each line except for the last line in a part that doesn't end with newline
                if(isLineEnd){
                    content.appendChild(document.createElement('br'));
                    linePrefix = '';
                }else{
                    if(!isRemoved){
                        linePrefix += cur_line;
                    }
                }
            }
        });

        // 根据最终行号计算 gutter 宽度（按数字位数估算）
        var maxLine = Math.max(1, localFinalLineNo - 1);
        var digits = String(maxLine).length;
        var gutterWidth = Math.min(200, Math.max(20, digits * 8 + 7));

        // 计算 gutter 高度，确保背景色和边框完整显示
        var gutterHeight = gutter.children.length * 20 + 12; // 每行20px

        // 将容器插入显示面板（如果尚未插入）
        // `display` 是 jQuery 对象，使用其 DOM 元素进行 contains/append 操作
        var dispEl = (display && display.length) ? display[0] : display;
        if(dispEl && typeof dispEl.contains === 'function'){
            if(!dispEl.contains(gutter)) dispEl.appendChild(gutter);
            if(!dispEl.contains(content)) dispEl.appendChild(content);
        }else{
            // 回退到 jQuery append
            if(display && display.append){
                display.append(gutter);
                display.append(content);
            }
        }

        // 在添加到DOM后设置宽度和高度，确保样式生效
        gutter.style.width = gutterWidth + 'px';
        gutter.style.flex = '0 0 ' + gutterWidth + 'px'; // 设置flex属性以确保在flex容器中正确显示
        gutter.style.height = gutterHeight + 'px';
    }

    // 首次渲染：使用已保存设置（如果有），否则显示全部
    var initRegex = _diff_saved_settings.regex || '';
    var initOnly = !!_diff_saved_settings.onlyChanges;
    var initExclude = _diff_saved_settings.excludeRegex || '';
    render(initRegex, initOnly, initExclude);
    MyModal.Info(display, title, '1000px', '600px', 'diff');

    // 设置跳转到上一个及下一个变更的位置的按钮
    var diff_btns = $("<div class='diff-btns'></div>");
    var top_btn = $("<button class='btn btn-default diff-top-btn' title='跳转到第一个变更'><span class='glyphicon glyphicon-arrow-up'></span></button>");
    var pre_btn = $("<button class='btn btn-default diff-pre-btn' title='前一个变更'><span class='glyphicon glyphicon-chevron-up'></span></button>");
    var next_btn = $("<button class='btn btn-default diff-next-btn' title='后一个变更'><span class='glyphicon glyphicon-chevron-down'></button>");
    // 添加拷贝之前之后的内容按钮
    var pre_copy_btn = $("<button class='btn btn-default diff-pre-copy-btn' title='拷贝原始数据内容'><span class='glyphicon glyphicon-file'> </span></button>");

    var settings_btn = $("<button class='btn btn-default diff-settings-btn' title='显示/过滤设置'><span class='glyphicon glyphicon-cog'></span></button>");

    // 根据设置状态更新图标
    function updateSettingsIcon(){
        var hasSettings = (_diff_saved_settings.regex || '') !== '' ||
                          (_diff_saved_settings.excludeRegex || '') !== '' ||
                          !!_diff_saved_settings.onlyChanges;
        var iconSpan = settings_btn.find('span');
        if(hasSettings){
            iconSpan.removeClass('glyphicon-cog').addClass('glyphicon-exclamation-sign');
        }else{
            iconSpan.removeClass('glyphicon-exclamation-sign').addClass('glyphicon-cog');
        }
    }
    updateSettingsIcon();

    diff_btns.append(top_btn);
    diff_btns.append(pre_btn);
    diff_btns.append(next_btn);
    diff_btns.append(pre_copy_btn);
    // 只对行模式显示settings按钮
    if(diff_mode === 'line'){
        diff_btns.append(settings_btn);
    }

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
                cur_span_parent.scrollTop(cur_span_parent_scroll_top + cur_span_top - 30);
                find_flag = true;
                return false;
            }
        });
        if(!find_flag){
            // 提示已无数据
            MyModal.Toast("已到顶");
        }
    });
    next_btn.click(()=>{
        var cur_span_parent = $("#diff-info");
        var cur_span_parent_scroll_top = cur_span_parent.scrollTop();
        var find_flag = false;
        // 顺序遍历#diff-info内的span元素
        $("#diff-info .diff-span").each(function(index, ele_dom){
            // 遍历#diff-info内的span元素，找到位于可视区域的前一个span元素
            var cur_span = $(ele_dom);
            // 相对于可视区域的位置
            var cur_span_top = cur_span.position().top;
            if(cur_span_top > 0){
                if(cur_span_top < cur_span_parent.height()){
                    return; // continue
                }
                cur_span_parent.scrollTop(cur_span_parent_scroll_top + cur_span_top - 30);
                find_flag = true;
                return false;
            }
        });
        if(!find_flag){
            // 提示已无数据
            MyModal.Toast("已到底");
        }
    });
    top_btn.click(()=>{
        var cur_span_parent = $("#diff-info");
        cur_span_parent.scrollTop(0);
        // 跳转到第一个变更
        var first_span = $("#diff-info .diff-span").first();
        if(first_span.length > 0){
            var first_span_top = first_span.position().top;
            cur_span_parent.scrollTop(first_span_top - 30);
        }
    });

    pre_copy_btn.click(()=>{
        CopyText(pre_content);
    });

    // 设置按钮：打开弹窗，允许输入行文本过滤正则以及是否只显示变更
    settings_btn.click(()=>{
        // 使用已保存的默认值回显
        var saved = _diff_saved_settings || {};
        var savedRegex = saved.regex || '';
        var savedOnly = saved.onlyChanges ? 'checked' : '';
        var savedExclude = saved.excludeRegex || '';
        var html = `
        <div class='form-group'>
            <label>行文本过滤正则（空为不使用）</label>
            <input type='text' id='diff-settings-regex' class='form-control' placeholder='例如: ^ERROR' value="${savedRegex}">
        </div>
        <div class='form-group'>
            <label>排除正则（满足此正则的行不显示）</label>
            <input type='text' id='diff-settings-exclude-regex' class='form-control' placeholder='例如: ^DEBUG' value="${savedExclude}">
        </div>
        <div class='form-group'>
            <label><input type='checkbox' id='diff-settings-only-changes' ${savedOnly}> 只显示变更行</label>
        </div>`;
        MyModal.Alert(html, function(){
            var regexStr = $('#diff-settings-regex').val() || '';
            var excludeRegexStr = $('#diff-settings-exclude-regex').val() || '';
            var onlyChanges = $('#diff-settings-only-changes').is(':checked');
            // 验证正则
            if(regexStr){
                try{ new RegExp(regexStr); }catch(e){ MyModal.Alert('正则表达式无效: ' + e); return; }
            }
            if(excludeRegexStr){
                try{ new RegExp(excludeRegexStr); }catch(e){ MyModal.Alert('排除正则表达式无效: ' + e); return; }
            }
            // 保存设置到会话内存（不写入磁盘）
            _diff_saved_settings.regex = regexStr;
            _diff_saved_settings.excludeRegex = excludeRegexStr;
            _diff_saved_settings.onlyChanges = onlyChanges;
            // 更新设置图标
            updateSettingsIcon();
            // 重新渲染 diff（行号仍使用未过滤的计数）
            render(regexStr, onlyChanges, excludeRegexStr);
        }, 600, 240, 'Diff Settings');
    });

    display.append(diff_btns);
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
    var html = `<button id="recent-repos-btn" class="top-btn" title="最近访问的仓库">最近</button>`;
    html += `<div id='saved-repo-list'>`;
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
    // 最近按钮点击后，切换最近仓库面板
    $('#recent-repos-btn').click(function(){
        if ($('#recent-repos-board').is(':visible')) {
            _RestoreFileView();
        } else {
            CallSys('get-recent-repos');
        }
    });
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
    // 关闭最近仓库面板
    $('#recent-repos-close-btn').click(function(){
        _RestoreFileView();
    });

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
        // 恢复右侧文件视图（如果处于最近面板状态）
        _RestoreFileView();
    
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

function ShowRecentRepos(repo_list){
    if (!repo_list || repo_list.length === 0) {
        MyModal.Alert("暂无最近访问记录");
        return;
    }
    // 隐藏树和文件列表，显示最近仓库面板（宽度撑满剩余空间）
    $('#tree-container').hide();
    $('#repo-files').hide();
    $('#recent-repos-board').show().css('width', 'calc(100% - 60px)');
    
    var html = '';
    for (var i = 0; i < repo_list.length; i++) {
        var url = repo_list[i];
        // 直接展示完整路径
        var display = url.replace(/\/$/,'');
        if (display.length > 60) {
            display = '...' + display.slice(-57);
        }
        html += `<div class='recent-repos-item' title="${url}" url="${url}">${display}</div>`;
    }
    $('#recent-repos-list').html(html);
    // 点击项填充到输入框并访问
    $(".recent-repos-item").click(function(){
        var repo_url = $(this).attr('url');
        $('#repo-url').val(repo_url);
        $('#access-btn').click();
    });
}

function _RestoreFileView() {
    $('#recent-repos-board').hide();
    $('#tree-container').show();
    $('#repo-files').show();
}

/**
 * 渲染操作日志表格（供 ShowActionLogs 和 batch-update-completed 共用）
 */
function _RenderActionLogTable(logs){
    if (!logs) logs = [];
    var reversed = logs.slice().reverse();
    var html = `<div class='action-log-container' style='font-size:12px;'>
        <table class='table table-condensed table-striped' style='margin-bottom:0;'>
            <thead><tr><th style='width:140px;'>Time</th><th>Level</th><th>Message</th></tr></thead>
            <tbody>`;
    for (var i = 0; i < reversed.length; i++) {
        var log = reversed[i];
        var time = log.create_time;
        if (time) {
            var d = new Date(time);
            time = MyDate.GetDateStr(d, true);
        }
        var levelClass = log.level === 'error' ? 'label label-danger' : log.level === 'warn' ? 'label label-warning' : 'label label-info';
        html += `<tr>
            <td style='white-space:nowrap;'>${time}</td>
            <td><span class='${levelClass}'>${log.level}</span></td>
            <td style='word-break:break-all;'>${log.message}</td>
        </tr>`;
    }
    html += `</tbody></table></div>`;
    // 替换内容（如果已存在）或创建新内容
    if ($('#my-alert-content .action-log-container').length > 0) {
        $('#my-alert-content .action-log-container').replaceWith(html);
    } else {
        $('#my-alert-content').html(html);
    }
}

function ShowActionLogs(logs){
    if (!logs || logs.length === 0) {
        MyModal.Alert("No action logs available");
        return;
    }
    // 构建表格HTML并用Alert显示
    var reversed = logs.slice().reverse();
    var html = `<div class='action-log-container' style='font-size:12px;'>
        <table class='table table-condensed table-striped' style='margin-bottom:0;'>
            <thead><tr><th style='width:140px;'>Time</th><th>Level</th><th>Message</th></tr></thead>
            <tbody>`;
    for (var i = 0; i < reversed.length; i++) {
        var log = reversed[i];
        var time = log.create_time;
        if (time) {
            var d = new Date(time);
            time = MyDate.GetDateStr(d, true);
        }
        var levelClass = log.level === 'error' ? 'label label-danger' : log.level === 'warn' ? 'label label-warning' : 'label label-info';
        html += `<tr>
            <td style='white-space:nowrap;'>${time}</td>
            <td><span class='${levelClass}'>${log.level}</span></td>
            <td style='word-break:break-all;'>${log.message}</td>
        </tr>`;
    }
    html += `</tbody></table></div>`;
    MyModal.Alert(html, null, 900, null, '操作日志');
    // 在模态框底部追加批量更新按钮（先移除旧的避免重复）
    var footer = $('#my-alert .modal-footer');
    $('#batch-update-btn').remove();
    $('#batch-update-status').remove();
    var btnHtml = `
        <button id="batch-update-btn" class="btn btn-primary btn-sm" style="margin-right:10px;">执行批量更新</button>
    `;
    $(btnHtml).insertBefore('#my-alert-ok');
    footer.prepend('<span id="batch-update-status" style="color:#888;display:none;line-height:30px;float:left;">批量更新进行中，请稍候...</span>');
    // 绑定批量更新按钮事件
    $('#batch-update-btn').on('click', function(){
        $(this).prop('disabled', true);
        $('#batch-update-status').show().text('批量更新进行中，请稍候...');
        CallSys('manual-batch-update');
    });
}

// ==================== 跨仓库文件搜索 ====================

/**
 * 打开跨仓库搜索对话框
 */
function OpenAllRepoSearchDialog() {
    g_search.isSearching = false;

    var html = `
    <div class="search-dialog">
        <div class="search-dialog-input-row">
            <input type="text" id="all-search-input" class="form-control search-dialog-input" placeholder="输入关键词搜索所有本地缓存的仓库文件" spellcheck="false" />
            <button id="all-search-btn" class="btn btn-primary btn-sm search-dialog-btn">搜索</button>
        </div>
        <div class="search-dialog-options-row">
            <a href="javascript:void(0)" id="all-search-clear-btn" class="search-dialog-clear-link" title="清空搜索框和搜索结果">清除</a>
            <label class="search-dialog-regex-label">
                <input type="checkbox" id="all-search-regex-mode" /> 正则
            </label>
            <span id="all-search-status" class="search-dialog-status"></span>
        </div>
        <div id="all-search-result-area" class="search-dialog-result-area">
            <div class="search-dialog-hint">输入关键词后点击"搜索"或按回车，搜索所有本地已缓存的仓库</div>
        </div>
        <div class="search-dialog-footer">点击结果项切换到对应仓库，然后在左侧树中展开定位</div>
    </div>`;

    MyModal.Info(html, '跨仓库搜索', '780px', 'auto', 'search');

    // 绑定事件
    $('#all-search-btn').off('click').on('click', function() {
        DoAllRepoSearch();
    });
    $('#all-search-input').off('keydown').on('keydown', function(e) {
        if (e.keyCode === 13) {
            DoAllRepoSearch();
        }
    });
    $('#all-search-clear-btn').off('click').on('click', function() {
        $('#all-search-input').val('');
        $('#all-search-result-area').html('<div class="search-dialog-hint">输入关键词后点击"搜索"或按回车</div>');
        $('#all-search-status').text('');
    });

    $('#my-infosearch').off('shown.bs.modal').on('shown.bs.modal', function() {
        $('#all-search-input').focus();
    });
}

/**
 * 执行跨仓库搜索
 */
function DoAllRepoSearch() {
    if (g_search.isSearching) return;

    var input = $('#all-search-input').val().trim();
    if (!input) {
        $('#all-search-status').text('请输入搜索关键词').css('color', '#d93025');
        return;
    }

    var isRegex = $('#all-search-regex-mode').is(':checked');
    g_search.isSearching = true;
    $('#all-search-btn').prop('disabled', true);
    $('#all-search-status').text('搜索中...').css('color', '#1a73e8');
    $('#all-search-result-area').html('<div class="search-dialog-hint">正在搜索所有已缓存的仓库，请稍候...</div>');

    CallSys('search-all-repos', { pattern: input, isRegex: isRegex });
}

/**
 * 显示跨仓库搜索结果
 */
function ShowAllRepoSearchResults(v) {
    g_search.isSearching = false;
    $('#all-search-btn').prop('disabled', false);

    if (v.error) {
        $('#all-search-status').text(v.error).css('color', '#d93025');
        $('#all-search-result-area').html('<div class="search-dialog-hint">' + v.error + '</div>');
        return;
    }

    var matched = v.matched || [];
    var stats = v.stats || { scanned: 0, found: 0, errors: [] };

    if (matched.length === 0) {
        var reason = stats.scanned === 0 ? '没有找到已缓存的仓库' : '未找到匹配的文件';
        $('#all-search-status').text(reason + ' (扫描 ' + stats.scanned + ' 个仓库)').css('color', '#888');
        $('#all-search-result-area').html('<div class="search-dialog-hint">' + reason + '</div>');
        return;
    }

    $('#all-search-status').text('共 ' + matched.length + ' 条结果 (扫描 ' + stats.scanned + ' 个仓库)').css('color', '#1a73e8');

    // 按 repo_name 分组
    var grouped = {};
    for (var i = 0; i < matched.length; i++) {
        var item = matched[i];
        if (!grouped[item.repo_name]) {
            grouped[item.repo_name] = { repo_url: item.repo_url, files: [] };
        }
        grouped[item.repo_name].files.push(item);
    }

    var html = '';
    var repoNames = Object.keys(grouped);
    for (var r = 0; r < repoNames.length; r++) {
        var repoName = repoNames[r];
        var group = grouped[repoName];
        html += '<div class="all-repo-search-group"><div class="all-repo-search-repo-name" title="' + group.repo_url + '">[' + repoName + ']</div>';
        for (var f = 0; f < group.files.length; f++) {
            var file = group.files[f];
            html += '<div class="all-repo-search-item" data-repo-url="' + file.repo_url + '" data-path="' + file.path + '" title="' + file.path + '">' + file.path + '</div>';
        }
        html += '</div>';
    }

    $('#all-search-result-area').html(html);

    // 点击结果项：切换到对应仓库
    $('.all-repo-search-item').off('click').on('click', function() {
        var repoUrl = $(this).data('repo-url');
        var filePath = $(this).data('path');
        // 先关闭搜索对话框
        $('#my-infosearch').modal('hide');
        // 切换到对应仓库
        $('#repo-url').val(repoUrl);
        $('#access-btn').click();
        // 延迟等待树加载后展开到对应路径
        setTimeout(function() {
            ExpandTreeToPath(filePath);
        }, 1000);
    });
}

/**
 * 在 jsTree 中按路径逐级展开到目标文件
 * @param {string} filePath - 如 "src/main/java/Test.java"
 */
function ExpandTreeToPath(filePath) {
    if (!filePath) return;
    var parts = filePath.split('/');
    var fileName = parts[parts.length - 1];
    var expandCount = Math.max(0, parts.length - 1);

    // 等待树就绪后逐级展开目录
    var retryCount = 0;
    (function expandStep(idx) {
        if (!$('#repo-tree').jstree) return;
        var tree = $('#repo-tree').jstree(true);
        if (!tree) {
            if (++retryCount < 10) {
                setTimeout(function() { expandStep(idx); }, 500);
            }
            return;
        }
        retryCount = 0;

        if (idx >= expandCount) {
            // 展开完成，高亮右侧文件列表中的目标文件
            _HighlightFileInList(fileName);
            return;
        }

        // 找到该层级节点并触发点击（模拟正常点击展开，触发 _RefreshNodeChildren 加载子节点）
        var nodes = tree.get_json('#', { flat: true });
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].text === parts[idx]) {
                // 如果节点已打开且已有子节点，直接进入下一级
                if (nodes[i].state && nodes[i].state.opened && nodes[i].children && nodes[i].children.length > 0) {
                    setTimeout(function() { expandStep(idx + 1); }, 100);
                    return;
                }
                // 触发点击展开
                var anchor = $('#' + nodes[i].id + ' > .jstree-anchor');
                if (anchor.length > 0) {
                    anchor.trigger('click');
                    // 等待子节点加载完成后继续（通过监听 before_open + 多次检查）
                    (function waitForChildren(nodeId, maxWait) {
                        if (maxWait <= 0) {
                            setTimeout(function() { expandStep(idx + 1); }, 100);
                            return;
                        }
                        var n = tree.get_node(nodeId);
                        if (n && n.state && n.state.opened && n.children && n.children.length > 0 &&
                            tree.get_node(n.children[0]) && tree.get_node(n.children[0]).text) {
                            // 子节点已加载
                            setTimeout(function() { expandStep(idx + 1); }, 100);
                        } else {
                            setTimeout(function() { waitForChildren(nodeId, maxWait - 1); }, 200);
                        }
                    })(nodes[i].id, 30);
                    return;
                }
            }
        }
        // 没找到节点，跳过
        setTimeout(function() { expandStep(idx + 1); }, 100);
    })(0);
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