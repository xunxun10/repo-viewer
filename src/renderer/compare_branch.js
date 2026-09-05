// 分支比对功能：左侧目录树选中 SVN 分支节点后，选择目标分支并展示变更文件列表，
// 点击文件可查看两分支间差异。第一层弹框内可切换比对目标分支。
var g_bc = {
    baseRoot: '',      // 源分支根 URL
    baseBranchName: '',// 源分支名
    branches: [],      // [{name, url}]
    targetUrl: '',     // 当前目标分支 URL
    targetName: '',    // 当前目标分支名
    defaultBranch: '', // 后端计算出的默认分支 URL（主线/main）
    mode: 'latest',   // 'latest'=与目标分支最新版比对(默认); 'base'=与目标分支拉分支时版本比对
};

/**
 * 打开分支比对第一层弹框
 * @param {Object} data {baseRoot, baseBranchName, defaultBranch, branches:[{name,url}]}
 */
function ShowBranchCompareDialog(data){
    g_bc.baseRoot = data.baseRoot;
    g_bc.baseBranchName = data.baseBranchName;
    g_bc.branches = data.branches || [];
    g_bc.defaultBranch = data.defaultBranch || '';

    var html = `
    <div id='bc-head'>
        <span class='bc-label'>目标分支:</span>
        <select id='bc-branch-select'></select>
        <label id='bc-fork-label' class='bc-latest-label' title='勾选则与目标分支拉分支时的版本比对；不勾选默认与目标分支最新版比对'>
            <input type='checkbox' id='bc-fork-mode'> 与目标分支拉分支时的版本比对
        </label>
        <span id='bc-hint' class='bc-hint'></span>
    </div>
    <div id='bc-file-container'>
        <div id='bc-file-list'></div>
    </div>`;

    MyModal.Info(html, `分支比对: ${g_bc.baseBranchName}`, '900px', '500px', 'branch');

    // 初始化下拉框
    var selectOpts = '';
    for(var i = 0; i < g_bc.branches.length; i++){
        var br = g_bc.branches[i];
        selectOpts += `<option value="${br.url}">${br.name}</option>`;
    }
    $('#bc-branch-select').html(selectOpts);

    // 默认比对 master/main(即主线 trunk/main/master)；若源分支就是主线，则默认选第一个非源分支
    var target = data.defaultBranch;
    if(!target || target === g_bc.baseRoot){
        for(var j = 0; j < g_bc.branches.length; j++){
            if(g_bc.branches[j].url !== g_bc.baseRoot){ target = g_bc.branches[j].url; break; }
        }
    }
    if(target){
        g_bc.targetUrl = target;
        $('#bc-branch-select').val(target);
    }

    // 仅当默认分支可计算 且 当前选中目标分支==该默认分支 时，才允许"与拉分支时版本"比对；否则强制最新版
    _UpdateForkAvail();

    // 切换目标分支时重新比对
    $('#bc-branch-select').off('change').on('change', function(){
        var sel = $(this).val();
        if(!sel){ return; }
        g_bc.targetUrl = sel;
        _UpdateForkAvail();
        _CompareBranches();
    });

    // 切换比对模式（勾选=与目标分支拉分支时版本比对；默认=最新版）
    $('#bc-fork-mode').off('change').on('change', function(){
        g_bc.mode = $(this).is(':checked') ? 'base' : 'latest';
        _CompareBranches();
    });

    // 首次比对
    _CompareBranches();
}

function _GetTargetName(url){
    for(var i = 0; i < g_bc.branches.length; i++){
        if(g_bc.branches[i].url === url){ return g_bc.branches[i].name; }
    }
    return url;
}

// 仅当默认分支可计算 且 当前选中目标分支==该默认分支 时，允许拉分支时版本比对；否则不可用并强制最新版
function _UpdateForkAvail(){
    var ok = !!g_bc.defaultBranch && !!g_bc.targetUrl && g_bc.targetUrl === g_bc.defaultBranch;
    if(ok){
        $('#bc-fork-mode').prop('disabled', false);
    }else{
        g_bc.mode = 'latest';
        $('#bc-fork-mode').prop('checked', false).prop('disabled', true);
    }
}

function _CompareBranches(){
    if(!g_bc.baseRoot || !g_bc.targetUrl){
        $('#bc-file-list').html('<div class="bc-empty">无可比对的目标分支</div>');
        return;
    }
    g_bc.targetName = _GetTargetName(g_bc.targetUrl);
    $('#bc-hint').text('正在比对: ' + g_bc.baseBranchName + ' ↔ ' + g_bc.targetName
        + (g_bc.mode === 'latest' ? '(最新版)' : '(拉分支时)') + ' ...');
    $('#bc-file-list').html('<div class="bc-empty">加载中...</div>');
    CallSys('compare-branch', { baseRoot: g_bc.baseRoot, targetUrl: g_bc.targetUrl, mode: g_bc.mode });
}

// 回渲染分支比对变更文件列表
function RenderBranchCompareList(v){
    if(!$('#bc-file-list').length){ return; }
    $('#bc-hint').text('');

    var html = '';
    if(!Array.isArray(v) || v.length === 0){
        $('#bc-file-list').html(`<div class="bc-empty">${g_bc.baseBranchName} 与 ${g_bc.targetName} 无差异</div>`);
        return;
    }
    html += `<div id='bc-file-list-head'>
        <span class='bc-col bc-status'>${v.length} 个文件</span>
        <span class='log-file-path'>点击文件查看变更信息（源 ${g_bc.baseBranchName} ↔ 目标 ${g_bc.targetName}）</span>
    </div>`;
    for(var i = 0; i < v.length; i++){
        var item = v[i];
        var title = item.baseUrl && item.targetUrl
            ? item.baseUrl + ' ↔ ' + item.targetUrl
            : (item.baseUrl || item.targetUrl || item.path);
        html += `<div class='log-file-item bc-file-item' data-base="${item.baseUrl || ''}" data-target="${item.targetUrl || ''}" title="${title}">
            <span class='log-file-action'>${item.status}</span>
            <span class='log-prop-action'></span>
            <span class='bc-file-path'>${item.path}</span>
        </div>`;
    }
    $('#bc-file-list').html(html);

    // 点击文件查看变更信息
    $('#bc-file-list .bc-file-item').off('click').on('click', function(){
        var base = $(this).attr('data-base');
        var target = $(this).attr('data-target');
        CallSys('compare-branch-file', { baseUrl: base || null, targetUrl: target || null });
    });
}

// 渲染单个文件的跨分支差异
function ShowBranchFileDiff(v){
    // 复用已有 diff 展示
    ShowFileDiff(v.pre, v.new, v.title || '分支文件差异');
}