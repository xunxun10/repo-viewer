// 仓库代码文件展示相关逻辑

function UpdateRepoFiles(repo_tree) {
    // 在repo-files中显示所有文件
    // 初始渲染
    gv.show_dirs = repo_tree.dirs || [];
    gv.show_files = repo_tree.files;
    $(".sortable").removeClass("ascending descending");
    // gv.gv_select_node为当前在左侧树中选中的节点id
    renderDirs(gv.show_dirs, gv.gv_select_node_id);
    renderFiles(gv.show_files);
}

/**
 * 渲染目录列表（显示在文件列表上方）
 * @param {*} dirs 格式类似[{text: 'dir1', date:'<date>'}, {text: 'dir2', date:'<date>'}]
 * @returns 
 */
function renderDirs(dirs, select_node_id=null) {
    if(!dirs || dirs.length === 0){
        $('#repo-dir-list').empty();
        return;
    }
    var dirHtml = '';
    const base = _GetSelPath();
    dirs.forEach(function(d){
        const full = base + '/' + d.text;
        //前置图标表示目录
        dirHtml += `<div class='repo-dir click-node' tabindex='0' data-full='${full}' node-text='${d.text}'>
            <span class='item-icon dir-icon'>📁</span>
            <span class='file-name'>${d.text}</span>
            <span class='file-size'></span>
            <span class='file-revision'></span>
            <span class='file-author'></span>
            <span class='file-date'>${d.date || ''}</span>
        </div>`;
    });
    // 插入到dir list
    $('#repo-dir-list').html(dirHtml);

    // 点击目录时在左侧树中展开对应节点
    $("#repo-dir-list").off('click', '.repo-dir').on('click', '.repo-dir', function(e){
        e.stopPropagation();
        const dir_name = $(this).attr('node-text');
        const dir_node = GetTreeChildNode(dir_name, select_node_id);
        TriggerTreeNodeClick(dir_node ? dir_node.id : null);
    });
}

// 渲染文件列表
function renderFiles(files) {
    function _SetFileNodeEvent() {
        // click-node点击时切换active类存在状态
        _ToggleActive(".repo-file.click-node", function (actice_obj) {
            // 展示当前文件的全路径
            Info(_GetSelPath());
        });

        // 双击文件获取文件内容
        $(".repo-file.click-node").off("dblclick").on("dblclick", function () {
            $(this).addClass('active');
            var path = _GetSelPath();
            CallSys('get-repo-file', path);
        });
    }

    function _SetRepoFileMenu(){
        // 鼠标右键按下时模拟一次点击
        $("#repo-files .repo-file").mousedown(function(e){
            if(e.button == 2){
                if(!$(this).hasClass('active')){
                    $(this).click();
                }
            }
        });
    
        // 创建右键菜单
        var menu_items = {
            showlog: { name: "show log", callback: function(key, opt){
                setTimeout(function(){
                    CallSys('get-repo-log', _GetSelPath());
                }, 300);
            }},
            showproperties: { name: "show properties", callback: function(key, opt){
                setTimeout(function(){
                    CallSys('get-repo-properties', _GetSelPath());
                }, 300);
            }},
        };
        // 仅在本地缓存状态下增加open folder菜单
        if (gv.gv_local_cached){
            //console.log('add open folder menu item with flag: ' + gv.gv_local_cached);
            menu_items.openfolder = { name: "open folder", callback: function(key, opt){
                setTimeout(function(){
                    var path = _GetSelPath();
                    var folder_path = path.split('/').slice(0, -1).join('/');
                    CallSys('open-repo-folder', folder_path);
                }, 300);
            }};
        }
        // Destroy any existing context menu before creating a new one
        if ($.contextMenu) {
            $.contextMenu('destroy', "#repo-files .repo-file");
        }
        // Create the context menu with the current menu items
        $.contextMenu({
            // define which elements trigger this menu
            selector: "#repo-files .repo-file",
            // define the elements of the menu
            items: menu_items,
        });
    }

    let fileHtml = '';
    for (var i = 0; i < files.length; i++) {
        fileHtml += `<div class='repo-file click-node' tabindex='0'>
            <span class='item-icon file-icon'>📄</span>
            <span class='file-name'>${files[i].text}</span>
            <span class='file-size'>${files[i].size}</span>
            <span class='file-revision'>${files[i].revision}</span>
            <span class='file-author'>${files[i].author}</span>
            <span class='file-date'>${files[i].date}</span>
            </div>`;
    }
    $('#repo-file-list').html(fileHtml);

    // 更新拷贝快捷键,需要延迟绑定
    setTimeout(function () {
        _SetFileNodeEvent();
        BindFilePathCopyHotKey(".repo-file");
        _SetRepoFileMenu();
    }, 500);
}

// 设置文件列表的视图的点击排序等事件
function SetFileHeadEvent() {
    // 点击列标题进行排序
    $(".sortable").off("click").on("click", function () {
        const sortKey = $(this).data("sort-key");
        const isAscending = ! $(this).hasClass("descending");
        
        // 排序文件
        gv.show_files.sort((a, b) => {
            if (a[sortKey] < b[sortKey]) return isAscending ? 1 : -1;
            if (a[sortKey] > b[sortKey]) return isAscending ? -1 : 1;
            return 0;
        });

        // 切换排序方向
        $(".sortable").removeClass("ascending descending");
        $(this).addClass(isAscending ? "descending" : "ascending");

        // 重新渲染文件列表
        renderFiles(gv.show_files);
    });
}

// ==================== 仓库文件搜索对话框 ====================

// 当前搜索对话框的状态
var g_search = {
    searchPath: '',     // 当前搜索的目录路径
    isSearching: false, // 是否正在搜索
    svnCached: false,   // SVN 是否已 checkout
    cacheProjectRoot: '', // 缓存的项目根 URL（后端返回）
    pattern: '',        // 当前搜索模式
    isRegex: false,     // 是否正则模式
};

/**
 * 检查路径是否为可搜索的有效路径
 * SVN 规则：只允许 trunk、branches/xxx、tags/xxx 及其子路径
 * Git 规则：只允许默认分支、branches/xxx、tags/xxx 及其子路径
 * 均不允许：仓库根路径、branches 列表、tags 列表
 */
function _IsValidSearchPath(path) {
    if (!path) return false;
    // 仓库根路径不可搜索
    if (path === gv.gv_repo_url || path === gv.gv_repo_head) return false;
    // branches/tags 列表页不可搜索
    if (/\/branches$/.test(path) || /\/tags$/.test(path)) return false;

    if (gv.gv_local_cached) {
        // Git 仓库：必须有具体分支名（branches/xxx、tags/xxx 或默认分支）
        // 排除裸仓库根、branches列表、tags列表后即可
        return true;
    } else {
        // SVN 仓库：必须包含 /trunk、/branches/xxx 或 /tags/xxx
        if (path.includes('/trunk')) return true;
        if (/\/branches\/[^\/]+/.test(path)) return true;
        if (/\/tags\/[^\/]+/.test(path)) return true;
        return false;
    }
}

/**
 * SVN checkout 失败回调 - 重置搜索状态
 */
function OnSvnCheckoutFailed(v) {
    g_search.isSearching = false;
    $('#search-btn').prop('disabled', false);
    $('#search-status').text('checkout 失败: ' + (v.error || '')).css('color', '#d93025');
}

/**
 * 打开搜索对话框
 * @param {string} searchPath - 当前选中的目录路径
 */
function OpenSearchDialog(searchPath) {
    if (!searchPath) {
        Info('search path is empty');
        return;
    }

    // 路径校验：只允许 trunk、branches/xxx、tags/xxx 及其子路径
    // 不允许：仓库根路径、branches 列表、tags 列表
    if (!_IsValidSearchPath(searchPath)) {
        MyModal.Alert('搜索仅支持在 trunk、branches/xxx、tags/xxx 及其子目录下使用');
        return;
    }

    g_search.searchPath = searchPath;
    g_search.isSearching = false;
    g_search.svnCached = false;

    // 检查是否 Git 仓库（有缓存的就是 Git）
    if (gv.gv_local_cached) {
        g_search.svnCached = true; // Git 总有缓存
    }

    // 构建对话框 HTML
    var dialogTitle = 'search files';
    var repoName = gv.gv_repo_url.split('/').pop() || '';
    var html = `
    <div class="search-dialog">
        <div class="search-dialog-path" title="${searchPath}">${searchPath}</div>
        <div class="search-dialog-input-row">
            <input type="text" id="search-input" class="form-control search-dialog-input" placeholder="输入搜索关键词，空格分隔多个词（顺序无关）" spellcheck="false" />
            <button id="search-btn" class="btn btn-primary btn-sm search-dialog-btn">搜索</button>
        </div>
        <div class="search-dialog-options-row">
            <a href="javascript:void(0)" id="search-clear-btn" class="search-dialog-clear-link" title="清空搜索框和搜索结果">清除</a>
            <label class="search-dialog-regex-label">
                <input type="checkbox" id="search-regex-mode" /> 正则
            </label>
            <span id="search-status" class="search-dialog-status"></span>
        </div>
        <div id="search-result-area" class="search-dialog-result-area">
            <div class="search-dialog-hint">输入关键词后点击"搜索"或按回车</div>
        </div>
        <div class="search-dialog-footer">点击结果项跳转到对应文件</div>
    </div>`;

    window._search_last_open_path = searchPath;

    MyModal.Info(html, dialogTitle, '780px', 'auto', 'search');

    // 绑定搜索事件
    _BindSearchEvents();

    // 对于 SVN，检查缓存状态（传入搜索路径以获取项目根信息）
    if (!gv.gv_local_cached) {
        CallSys('check-svn-cache', {searchPath: g_search.searchPath});
    }

    // 聚焦输入框（模态框显示完成后）
    $('#my-infosearch').off('shown.bs.modal').on('shown.bs.modal', function() {
        $('#search-input').focus();
    });
}

/**
 * 绑定搜索对话框事件
 */
function _BindSearchEvents() {
    // 搜索按钮
    $('#search-btn').off('click').on('click', function() {
        DoSearch();
    });

    // 回车键
    $('#search-input').off('keydown').on('keydown', function(e) {
        if (e.keyCode === 13) {
            DoSearch();
        }
    });

    // 清除按钮
    $('#search-clear-btn').off('click').on('click', function() {
        $('#search-input').val('');
        $('#search-result-area').html('<div class="search-dialog-hint">输入关键词后点击"搜索"或按回车</div>');
        $('#search-status').text('');
    });
}

/**
 * 执行搜索
 */
function DoSearch() {
    if (g_search.isSearching) return;

    var pattern = $('#search-input').val();
    if (!pattern || !pattern.trim()) {
        $('#search-status').text('请输入搜索关键词').css('color', '#d93025');
        return;
    }

    var isRegex = $('#search-regex-mode').is(':checked');
    g_search.pattern = pattern;
    g_search.isRegex = isRegex;

    // SVN 且未缓存时，需要先确认 checkout
    if (!gv.gv_local_cached && !g_search.svnCached) {
        // 使用后端返回的项目根作为 checkout 提示路径
        var cachePath = g_search.cacheProjectRoot || g_search.searchPath;
        var confirmHtml = `
        <div>
            <p>搜索需要先 checkout 仓库到本地：</p>
            <p style="word-break:break-all;font-size:12px;color:#5f6368;">${cachePath}</p>
            <p>是否继续？</p>
        </div>`;
        MyModal.Confirm(confirmHtml, function() {
            // 用户确认，开始 checkout（传入搜索路径）
            $('#search-status').text('正在 checkout 仓库到本地...').css('color', '#1a73e8');
            g_search.isSearching = true;
            $('#search-btn').prop('disabled', true);
            CallSys('checkout-svn-repo', {searchPath: g_search.searchPath});
        }, null, null, '确认 checkout');
        return;
    }

    // 执行搜索
    _ExecuteSearch(pattern, isRegex);
}

/**
 * 实际发起搜索请求
 */
function _ExecuteSearch(pattern, isRegex) {
    g_search.isSearching = true;
    $('#search-btn').prop('disabled', true);
    $('#search-status').text('搜索中...').css('color', '#1a73e8');
    $('#search-result-area').html('<div class="search-dialog-loading">搜索中...</div>');

    CallSys('search-repo-files', {
        path: g_search.searchPath,
        pattern: pattern,
        isRegex: isRegex,
    });
}

/**
 * SVN 缓存状态回调
 * @param {object} v - {cached: bool, local_path: string}
 */
function OnSvnCacheStatus(v) {
    g_search.svnCached = v.cached;
    g_search.cacheProjectRoot = v.projectRoot || '';
    if (v.cached) {
        $('#search-status').text('本地缓存就绪').css('color', '#188038');
        // 如果有等待中的搜索（checkout 前已输入关键词），重新读取当前输入再执行
        if (g_search.isSearching) {
            var currentPattern = $('#search-input').val();
            if (currentPattern && currentPattern.trim()) {
                var currentRegex = $('#search-regex-mode').is(':checked');
                _ExecuteSearch(currentPattern, currentRegex);
            }
        }
    }
}

/**
 * 在对话框中显示搜索结果
 * @param {object} v - {matched: array, error: string}
 */
function ShowSearchResultsInDialog(v) {
    g_search.isSearching = false;
    $('#search-btn').prop('disabled', false);

    if (v.error) {
        $('#search-status').text(v.error).css('color', '#d93025');
        $('#search-result-area').html('<div class="search-dialog-error">' + v.error + '</div>');
        return;
    }

    var matched = v.matched || [];
    if (matched.length === 0) {
        $('#search-status').text('无匹配结果').css('color', '#5f6368');
        $('#search-result-area').html('<div class="search-dialog-hint">未找到匹配的文件</div>');
        return;
    }

    $('#search-status').text('找到 ' + matched.length + ' 个匹配文件').css('color', '#188038');

    var html = '<div class="search-result-list">';
    for (var i = 0; i < matched.length; i++) {
        var file = matched[i];
        var displayPath = (file.path || file.text || '');
        var size = (file.size || '');
        // 使用 data 属性安全传递路径，文本内容通过 text() 设置避免 XSS
        html += `<div class="search-result-item" data-path="${displayPath.replace(/"/g, '&quot;')}" title="${displayPath.replace(/"/g, '&quot;')}">
            <span class="search-result-icon">📄</span>
            <span class="search-result-path"></span>
            <span class="search-result-meta"></span>
        </div>`;
    }
    html += '</div>';
    $('#search-result-area').html(html);

    // 安全设置文本内容（避免 XSS）
    $('.search-result-item').each(function() {
        var idx = $(this).index();
        var file = matched[idx];
        if (file) {
            $(this).find('.search-result-path').text(file.path || file.text || '');
            var meta = (file.size || '');
            $(this).find('.search-result-meta').text(meta);
        }
    });

    // 绑定点击跳转事件
    $('.search-result-item').off('click').on('click', function() {
        var filePath = $(this).attr('data-path');
        // 关闭搜索对话框（MyModal.Info 生成的 id 为 my-infosearch）
        $('#my-infosearch').modal('hide');
        // 跳转到文件
        _JumpToFile(filePath, g_search.searchPath);
    });
}

/**
 * 跳转到文件 - 在树中逐级展开到目标文件所在目录并高亮
 * @param {string} relativePath - 搜索结果相对路径，如 "src/utils/helper.js"
 * @param {string} searchPath - 搜索时的起始目录路径，如 "http://svn/repo/trunk/src"
 */
function _JumpToFile(relativePath, searchPath) {
    // 分隔路径
    var segments = relativePath.split('/');
    var fileName = segments.pop();  // 最后一个 segment 是文件名

    // 计算从 repo 根到目标目录的完整路径
    // searchPath 是当前选中的目录 URL
    // relativePath 是相对于 searchPath 的路径
    var fullPath = searchPath.replace(/\/$/, '') + '/' + relativePath;

    Info('jump to: ' + fullPath);

    // 逐级展开目录
    // 从当前选中节点开始，找到匹配的子节点并展开
    var tree = $('#repo-tree').jstree(true);
    if (!tree) return;

    // 先选中搜索开始时的节点（当前已选中的目录节点）
    var startNode = gv.gv_select_node;
    if (!startNode) return;

    _ExpandPathRecursive(startNode.id, segments.slice(), fileName);
}

// 跳转文件时，子节点等待重试的最大次数
const _EXPAND_RETRY_MAX = 10;

/**
 * 递归展开路径
 * @param {string} nodeId - 当前节点的 id（不带 # 前缀）
 * @param {Array} dirSegments - 剩余目录路径段
 * @param {string} fileName - 目标文件名
 * @param {number} retryCount - 当前重试次数
 */
function _ExpandPathRecursive(nodeId, dirSegments, fileName, retryCount) {
    if (retryCount === undefined) retryCount = 0;
    var tree = $('#repo-tree').jstree(true);
    if (!tree) return;

    // 每次从 jsTree 内部模型重新获取节点，避免引用过期
    var node = tree.get_node(nodeId);
    if (!node) return;

    if (dirSegments.length === 0) {
        // 所有目录都已展开，当前节点就是目标目录
        $('#' + node.id + ' > .jstree-anchor').trigger('click');
        setTimeout(function() {
            _HighlightFileInList(fileName);
        }, 500);
        return;
    }

    var targetDir = dirSegments.shift();

    // 查找当前节点下匹配 targetDir 的子节点
    var children = tree.get_node(node.id).children;
    var found = false;
    for (var i = 0; i < children.length; i++) {
        var child = tree.get_node(children[i]);
        if (child && child.text === targetDir) {
            found = true;
            if (!child.state || !child.state.opened) {
                // 节点未打开：监听 after_open 事件后递归
                var childId = child.id;
                $('#repo-tree').one('after_open.jstree', function(e, data) {
                    if (data.node && data.node.id === childId) {
                        // after_open 时子节点可能仍在异步加载，延迟后再用 id 重新获取节点
                        setTimeout(function() {
                            var freshNode = tree.get_node(childId);
                            if (freshNode) {
                                _ExpandPathRecursive(freshNode.id, dirSegments, fileName);
                            }
                        }, 300);
                    }
                });
                $('#' + child.id + ' > .jstree-anchor').trigger('click');
            } else {
                setTimeout(function() {
                    _ExpandPathRecursive(child.id, dirSegments, fileName);
                }, 300);
            }
            return;
        }
    }
    // 未找到：子节点可能还在异步加载中，定期重试直至超时
    if (!found) {
        if (retryCount < _EXPAND_RETRY_MAX) {
            setTimeout(function() {
                // 重试时重新用 nodeId 获取最新节点数据
                _ExpandPathRecursive(nodeId, [targetDir].concat(dirSegments), fileName, retryCount + 1);
            }, 500);
        } else {
            Info('跳转失败: 未找到目录 "' + targetDir + '"（已重试 ' + _EXPAND_RETRY_MAX + ' 次）');
        }
    }
}

/**
 * 在文件列表中高亮目标文件
 * @param {string} fileName - 目标文件名
 */
function _HighlightFileInList(fileName) {
    var fileItems = $('#repo-file-list .repo-file');
    var found = false;
    // 先清除之前的搜索跳转高亮
    fileItems.removeClass('search-jump');
    fileItems.each(function() {
        var name = $(this).find('.file-name').text().trim();
        if (name === fileName) {
            $(this).addClass('search-jump');
            // 滚动到可见区域
            var container = $('#repo-files');
            var offset = $(this).position().top;
            container.scrollTop(container.scrollTop() + offset - container.height() / 2);
            found = true;
            return false;
        }
    });
    if (!found) {
        Info('文件 "' + fileName + '" 不在当前目录列表中（可能在子目录中）');
    }
}