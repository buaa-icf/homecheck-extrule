const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let cachedChartSource = null;

function loadChartSource() {
  if (cachedChartSource === null) {
    const chartEntry = require.resolve('chart.js');
    const chartPath = path.join(path.dirname(chartEntry), 'chart.umd.js');
    cachedChartSource = fs.readFileSync(chartPath, 'utf8').replace(/<\/script/gi, '<\\/script');
  }
  return cachedChartSource;
}

function serializeForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildDashboardHtml(staticPayload = null) {
  const chartSource = loadChartSource();
  const payload = staticPayload === null ? 'null' : serializeForScript(staticPayload);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ArkTS 检测器性能面板</title>
  <style>
    :root { color-scheme: dark; --bg:#0a1120; --panel:#101b2e; --line:rgba(120,160,220,.14); --text:#e6edf8; --muted:#8ea2c0; --cyan:#22d3ee; --violet:#8b5cf6; --green:#34d399; --red:#fb7185; --amber:#fbbf24; }
    * { box-sizing: border-box; }
    html { background:var(--bg); }
    body { margin:0; min-height:100vh; color:var(--text); font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow-x:hidden;
      background:radial-gradient(900px 480px at 15% -8%,rgba(34,211,238,.07),transparent 65%),
        radial-gradient(900px 520px at 85% 4%,rgba(139,92,246,.05),transparent 68%); }
    main { width:min(1500px,calc(100% - 32px)); margin:0 auto; padding:34px 0 56px; position:relative; z-index:1; }
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:24px; }
    h1 { margin:0 0 8px; font-size:clamp(24px,3vw,36px); letter-spacing:-.02em; color:var(--text); font-weight:700; }
    .subtitle,.muted { color:var(--muted); }
    .status { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--line); background:rgba(13,25,41,.6); border-radius:999px; padding:8px 14px; white-space:nowrap; }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--amber); }
    .status.completed .dot { background:var(--green); }
    .status.failed .dot { background:var(--red); }
    .status.running .dot { animation:pulse 1.4s infinite; }
    @keyframes pulse { 50% { opacity:.4; } }
    .cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin-bottom:14px; }
    .card,.panel { position:relative; background:var(--panel); border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 28px rgba(0,0,0,.25); }
    .card { padding:16px 18px; min-height:96px; transition:border-color .2s; }
    .card:hover { border-color:rgba(34,211,238,.35); }
    .label { color:var(--muted); font-size:12px; letter-spacing:.06em; margin-bottom:10px; }
    .value { font-size:24px; font-weight:700; letter-spacing:-.01em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .unit { font-size:13px; font-weight:500; color:var(--muted); margin-left:4px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(560px,100%),1fr)); gap:14px; }
    #f1ChartPanel { grid-column:1 / -1; }
    .panel { padding:18px; min-width:0; }
    .panel-head { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:12px; }
    h2 { margin:0; font-size:16px; letter-spacing:.01em; display:flex; align-items:center; gap:9px; }
    h2::before { content:""; width:3px; height:14px; border-radius:2px; flex:none; background:var(--cyan); opacity:.8; }
    .chart-wrap { height:330px; }
    .table-panel { margin-top:14px; overflow:hidden; padding:0; }
    .table-title { padding:18px 18px 12px; }
    .table-scroll { overflow:auto; }
    .table-scroll::-webkit-scrollbar { height:8px; width:8px; }
    .table-scroll::-webkit-scrollbar-thumb { background:rgba(120,160,220,.22); border-radius:8px; }
    .table-scroll::-webkit-scrollbar-track { background:transparent; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th,td { padding:12px 16px; border-top:1px solid var(--line); text-align:left; white-space:nowrap; }
    th { color:var(--muted); font-weight:600; font-size:12px; letter-spacing:.04em; background:#0d1727; }
    tbody tr:nth-child(even) { background:rgba(145,163,187,.04); }
    tbody tr { transition:background .15s; }
    tbody tr:hover td { background:rgba(34,211,238,.05); }
    td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
    .value { font-variant-numeric:tabular-nums; }
    .ok { color:var(--green); }
    .bad { color:var(--red); }
    @media (max-width:900px) { .cards { grid-template-columns:1fr 1fr; }.grid { grid-template-columns:1fr; } header { flex-direction:column; } }
    @media (max-width:520px) { main { width:min(100% - 20px,1500px); padding-top:18px; }.cards { grid-template-columns:1fr; }.chart-wrap { height:280px; } }
  </style>
</head>
<body>
  <main>
    <header><div><h1>ArkTS 检测器性能面板</h1><div class="subtitle" id="timeRange">等待性能测试开始</div></div><div class="status" id="status"><span class="dot"></span><span id="statusText">准备中</span></div></header>
    <section class="cards">
      <div class="card"><div class="label">当前仓库</div><div class="value" id="currentTask">—</div></div>
      <div class="card"><div class="label">运行时间</div><div class="value" id="elapsed">0.0<span class="unit">秒</span></div></div>
      <div class="card"><div class="label">当前 / 峰值 RSS</div><div class="value" id="rss">0 / 0<span class="unit">MB</span></div></div>
      <div class="card"><div class="label">仓库进度</div><div class="value" id="progress">0 / 0</div></div>
    </section>
    <section class="grid">
      <article class="panel"><div class="panel-head"><h2>仓库共享峰值 RSS</h2><span class="muted">Scene + 全部选中规则</span></div><div class="chart-wrap"><canvas id="memoryChart"></canvas></div></article>
      <article class="panel"><div class="panel-head"><h2>检测器吞吐</h2><span class="muted" id="throughputSummary">不含共享预处理 · 性能基准 ≥ 2 万行/秒</span></div><div class="chart-wrap"><canvas id="throughputChart"></canvas></div></article>
      <article class="panel" id="f1ChartPanel"><div class="panel-head"><h2>F1 图表</h2><span class="muted">按规则汇总 · 随仓库完成实时更新</span></div><div class="chart-wrap"><canvas id="f1Chart"></canvas></div></article>
    </section>
    <section class="panel table-panel"><h2 class="table-title">检测器性能 <span class="muted" style="font-size:12px;font-weight:400">峰值 RSS 为仓库级共享（全部规则同进程检测）</span></h2><div class="table-scroll"><table><thead><tr><th>仓库</th><th>规则</th><th>状态</th><th class="num">检测耗时 (s)<div style="font-size:11px;font-weight:400">不含共享预处理</div></th><th class="num">告警数</th><th class="num">峰值 RSS (MB)</th><th class="num">吞吐 (万行/s)</th><th>基准结果</th></tr></thead><tbody id="resultsBody"></tbody></table></div></section>
    <section class="panel table-panel"><h2 class="table-title">仓库共享资源</h2><div class="table-scroll"><table><thead><tr><th>仓库</th><th>规则</th><th>状态</th><th class="num">.ets 代码行数</th><th class="num">预处理耗时 (s)<div style="font-size:11px;font-weight:400">Scene 构建等共享开销</div></th><th class="num">分析耗时 (s)<div style="font-size:11px;font-weight:400">全部选中规则合计</div></th><th class="num">峰值 RSS (MB)</th></tr></thead><tbody id="repositoriesBody"></tbody></table></div></section>
    <section class="panel table-panel" id="f1Panel"><h2 class="table-title">F1 评估（数据集仓库）</h2><div class="table-scroll"><table><thead><tr><th>规则</th><th class="num">TP<div style="font-size:11px;font-weight:400">命中正例</div></th><th class="num">FP<div style="font-size:11px;font-weight:400">误报告警</div></th><th class="num">FN<div style="font-size:11px;font-weight:400">漏报正例</div></th><th class="num">TN<div style="font-size:11px;font-weight:400">未告警负例</div></th><th class="num">Precision<div style="font-size:11px;font-weight:400">TP/(TP+FP)</div></th><th class="num">Recall<div style="font-size:11px;font-weight:400">TP/(TP+FN)</div></th><th class="num">F1<div style="font-size:11px;font-weight:400">2PR/(P+R)</div></th></tr></thead><tbody id="f1Body"></tbody></table></div><div class="muted" style="padding:0 18px 14px;font-size:12px">规则行与 TOTAL 行均为计数加总后再计算（micro/加权平均）；FP 按告警条数统计，TN 按负例标注条数统计</div></section>
  </main>
  <script>${chartSource}</script>
  <script>
    window.__ARKTS_DASHBOARD_DATA__ = ${payload};
    (function () {
      var staticMode = window.__ARKTS_DASHBOARD_DATA__ !== null;
      var state = window.__ARKTS_DASHBOARD_DATA__;
      var throughputTarget = 2;
      var throughputTargetPlugin = {
        id:'throughputTarget',
        afterDraw:function(chart){
          var y=chart.scales.y.getPixelForValue(throughputTarget); var area=chart.chartArea; var ctx=chart.ctx;
          if(!Number.isFinite(y)||y<area.top||y>area.bottom){return;}
          ctx.save(); ctx.strokeStyle='#fbbf24'; ctx.lineWidth=2; ctx.setLineDash([7,5]);
          ctx.beginPath(); ctx.moveTo(area.left,y); ctx.lineTo(area.right,y); ctx.stroke();
          ctx.setLineDash([]); ctx.fillStyle='#fbbf24'; ctx.font='600 12px Inter, sans-serif'; ctx.textAlign='right';
          ctx.fillText('性能基准 2 万行/秒',area.right-6,y-7); ctx.restore();
        }
      };
      var smellColors={'code-clone-fragment':'#22d3ee','feature-envy':'#fbbf24','long-method':'#34d399','switch-statement':'#fb7185'};
      var repoNameAliases={'agc-template-market-harmonyos-demos':'agc-demos','applications_photos':'photos','applications_settings':'settings','model-evaluation-testsuite':'model-eval','openharmony_tpc_samples':'tpc-samples','ostest_integration_test':'ostest','arkui_ace_engine':'ace-engine'};
      var throughputRepos=[];
      function shortRepoName(name){ if(!name){return '—';} if(repoNameAliases[name]){return repoNameAliases[name];} return name.length>16?name.slice(0,15)+'…':name; }
      var tooltipStyle={backgroundColor:'#0d1929',borderColor:'#22334b',borderWidth:1,titleColor:'#e8f0fb',bodyColor:'#c9d6e8',padding:10};
      var tickStyle={color:'#91a3bb'};
      var memoryChart = new Chart(document.getElementById('memoryChart'), { type:'line', data:{labels:[],datasets:[{label:'峰值 RSS (MB)',data:[],borderColor:'#22d3ee',backgroundColor:'rgba(34,211,238,.12)',fill:true,borderWidth:2,pointRadius:4,tension:.18}]}, options:{responsive:true,maintainAspectRatio:false,animation:false,scales:{x:{grid:{color:'rgba(145,163,187,.12)'},ticks:tickStyle},y:{beginAtZero:true,title:{display:true,text:'峰值 RSS (MB)',color:'#91a3bb'},ticks:tickStyle,grid:{color:'rgba(145,163,187,.12)'}}},plugins:{legend:{display:false},tooltip:tooltipStyle}} });
      var throughputChart = new Chart(document.getElementById('throughputChart'), { type:'line', plugins:[throughputTargetPlugin], data:{labels:[],datasets:[]}, options:{responsive:true,maintainAspectRatio:false,animation:false,layout:{padding:{top:18}},scales:{x:{grid:{color:'rgba(145,163,187,.12)'},ticks:{color:'#91a3bb',maxRotation:30}},y:{type:'logarithmic',min:1,max:1000,title:{display:true,text:'万行/秒（对数刻度）',color:'#91a3bb'},ticks:Object.assign({},tickStyle,{callback:function(value){return value===throughputTarget?'2（性能基准）':String(value);}}),afterBuildTicks:function(axis){axis.ticks=[1,2,5,10,20,50,100,200,500,1000].map(function(value){return {value:value};});},grid:{color:function(context){return context.tick.value===throughputTarget?'rgba(251,191,36,.45)':'rgba(145,163,187,.12)';}}}},plugins:{legend:{display:true,position:'bottom',labels:{color:'#91a3bb',boxWidth:14,padding:16}},tooltip:Object.assign({},tooltipStyle,{callbacks:{title:function(items){return items.length?throughputRepos[items[0].dataIndex]||'':'';},label:function(context){var value=context.parsed.y;return context.dataset.label+'：'+value.toFixed(4)+' 万行/秒（'+(value>=throughputTarget?'已达到':'待提升')+'，性能基准的 '+(value/throughputTarget).toFixed(2)+' 倍）';}}})}} });
      var f1Chart = new Chart(document.getElementById('f1Chart'), { type:'bar', data:{labels:[],datasets:[{label:'Precision',data:[],backgroundColor:'#22d3ee'},{label:'Recall',data:[],backgroundColor:'#34d399'},{label:'F1',data:[],backgroundColor:'#fbbf24'}]}, options:{responsive:true,maintainAspectRatio:false,animation:false,scales:{x:{grid:{display:false},ticks:tickStyle},y:{min:0,max:100,title:{display:true,text:'%',color:'#91a3bb'},ticks:tickStyle,grid:{color:'rgba(145,163,187,.12)'}}},plugins:{legend:{position:'bottom',labels:{color:'#91a3bb',boxWidth:14,padding:16}},tooltip:Object.assign({},tooltipStyle,{callbacks:{label:function(context){return context.dataset.label+'：'+context.parsed.y.toFixed(2)+'%';}}})}} });

      function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '—'; }
      function repositoryLabel(run) { return run ? shortRepoName(run.repoName) : '—'; }
      function render() {
        if(!state){ return; }
        var status=document.getElementById('status'); status.className='status '+state.status; document.getElementById('statusText').textContent=state.status==='completed'?'已完成':state.status==='failed'?'运行失败':state.status==='running'?'运行中':'准备中';
        document.getElementById('timeRange').textContent=formatTime(state.startedAt)+' — '+(state.finishedAt?formatTime(state.finishedAt):'运行中');
        document.getElementById('currentTask').textContent=state.current ? (state.current.kind==='scan'?state.current.repoName+' / 共享 Scene':state.current.label) : '—';
        var active=state.current && state.current.kind==='scan' ? state.current : null; var samples=active && active.memorySamples ? active.memorySamples : []; var latest=samples.length?samples[samples.length-1]:null;
        document.getElementById('elapsed').innerHTML=((active?active.elapsedMs:0)/1000).toFixed(1)+'<span class="unit">秒</span>';
        document.getElementById('rss').innerHTML=(latest?latest.rssMB.toFixed(1):'0')+' / '+(active?active.peakRssMB.toFixed(1):'0')+'<span class="unit">MB</span>';
        document.getElementById('progress').textContent=(state.repositoryRuns||[]).length+' / '+state.totalRuns;
        renderMemory(); renderThroughput(); renderTable(); renderRepositoryTable(); renderF1();
      }
      function renderF1(){ var panel=document.getElementById('f1Panel'); var chartPanel=document.getElementById('f1ChartPanel'); if(!state.f1||!state.f1.perRule){panel.style.display='none';chartPanel.style.display='none';return;} panel.style.display=''; chartPanel.style.display=''; var body=document.getElementById('f1Body'); body.replaceChildren(); var rows=state.f1.overall?state.f1.perRule.concat([state.f1.overall]):state.f1.perRule; rows.forEach(function(rule){ var row=document.createElement('tr'); if(rule.rule==='TOTAL'){row.style.fontWeight='700';row.style.background='rgba(34,211,238,.06)';} var formatPct=function(value){return value===null||value===undefined?'—':(value*100).toFixed(2)+'%';}; var values=[rule.smell,String(rule.tp),String(rule.fp),String(rule.fn),rule.tn===null||rule.tn===undefined?'—':String(rule.tn),formatPct(rule.precision),formatPct(rule.recall),formatPct(rule.f1)]; values.forEach(function(value,index){var cell=document.createElement('td');cell.textContent=value;if(index>=1)cell.className='num';row.appendChild(cell);});body.appendChild(row);});
        var pct=function(value){return value===null||value===undefined?null:Math.round(value*10000)/100;};
        f1Chart.data.labels=state.f1.perRule.map(function(rule){return rule.smell;});
        f1Chart.data.datasets[0].data=state.f1.perRule.map(function(rule){return pct(rule.precision);});
        f1Chart.data.datasets[1].data=state.f1.perRule.map(function(rule){return pct(rule.recall);});
        f1Chart.data.datasets[2].data=state.f1.perRule.map(function(rule){return pct(rule.f1);});
        f1Chart.update('none'); }
      function renderMemory(){ var runs=(state.repositoryRuns||[]).filter(function(run){return Number(run.peakRssMB)>0;}); var active=state.current&&state.current.kind==='scan'&&Number(state.current.peakRssMB)>0?state.current:null; if(active){runs=runs.concat([active]);} memoryChart.data.labels=runs.map(repositoryLabel); memoryChart.data.datasets[0].data=runs.map(function(run){return run.peakRssMB;}); memoryChart.update('none'); }
      function renderThroughput(){ var valid=state.runs.filter(function(run){return run.success && Number(run.throughputWanLinesPerSecond)>0;}); var values=valid.map(function(run){return run.throughputWanLinesPerSecond;}); var passed=values.filter(function(value){return value>=throughputTarget;}).length; var minimum=values.length?Math.min.apply(null,values):null;
        throughputRepos=[]; valid.forEach(function(run){ if(throughputRepos.indexOf(run.repoName)===-1){throughputRepos.push(run.repoName);} });
        var smells=[]; valid.forEach(function(run){ if(smells.indexOf(run.smell)===-1){smells.push(run.smell);} });
        throughputChart.data.labels=throughputRepos.map(shortRepoName);
        throughputChart.data.datasets=smells.map(function(smell){ var color=smellColors[smell]||'#91a3bb'; var data=throughputRepos.map(function(repoName){ var match=valid.find(function(run){return run.repoName===repoName&&run.smell===smell;}); return match?match.throughputWanLinesPerSecond:null; }); var pointColors=data.map(function(value){return value===null?color:(value>=throughputTarget?'#34d399':'#fb7185');}); return {label:smell,data:data,borderColor:color,backgroundColor:color,borderWidth:2,pointRadius:4,pointHoverRadius:6,tension:.18,spanGaps:false,pointBackgroundColor:pointColors,pointBorderColor:pointColors}; });
        document.getElementById('throughputSummary').textContent=values.length?'不含共享预处理 · 性能基准 ≥ 2 万行/秒 · 达到基准 '+passed+' / '+values.length+' · 最低 '+minimum.toFixed(4):'不含共享预处理 · 性能基准 ≥ 2 万行/秒'; throughputChart.update('none'); }
      function renderTable(){ var body=document.getElementById('resultsBody'); body.replaceChildren(); state.runs.forEach(function(run){ var row=document.createElement('tr'); var throughput=run.throughputWanLinesPerSecond; var target=throughput===null?'—':throughput>=throughputTarget?'已达到':'待提升'; var peakRss=run.peakRssMB; var values=[run.repoName,run.smell,run.success?'成功':run.timedOut?'超时':'失败',(run.detectorDurationMs/1000).toFixed(2),String(run.issueMessages),peakRss===null||peakRss===undefined?'—':peakRss.toFixed(2),throughput===null?'—':throughput.toFixed(4),target]; values.forEach(function(value,index){var cell=document.createElement('td');cell.textContent=value;if(index>=3&&index<=6)cell.className='num';if(index===2)cell.className=run.success?'ok':'bad';if(index===7&&throughput!==null)cell.className=throughput>=throughputTarget?'ok':'bad';row.appendChild(cell);});body.appendChild(row);}); }
      function renderRepositoryTable(){ var body=document.getElementById('repositoriesBody'); body.replaceChildren(); (state.repositoryRuns||[]).forEach(function(run){ var row=document.createElement('tr'); var seconds=function(ms){return ms===null||ms===undefined?'—':(ms/1000).toFixed(2);}; var values=[run.repoName,run.rules.join(', '),run.success?'成功':run.timedOut?'超时':'失败',run.etsLines===null||run.etsLines===undefined?'—':String(run.etsLines),seconds(run.preprocessingMs),seconds(run.analysisMs),run.peakRssMB.toFixed(2)]; values.forEach(function(value,index){var cell=document.createElement('td');cell.textContent=value;if(index>=3)cell.className='num';if(index===2)cell.className=run.success?'ok':'bad';row.appendChild(cell);});body.appendChild(row);}); }
      async function refresh(){ if(staticMode){render();return;} try{var response=await fetch('/api/state',{cache:'no-store'});if(response.ok){state=await response.json();render();if(state&&(state.status==='completed'||state.status==='failed')&&pollTimer){clearInterval(pollTimer);pollTimer=null;}}}catch(error){document.getElementById('statusText').textContent='连接中断';} }
      var pollTimer=null;
      refresh(); if(!staticMode){pollTimer=setInterval(refresh,1000);}
    }());
  </script>
</body>
</html>`;
}

function startDashboardServer(options) {
  const host = '127.0.0.1';
  const liveHtml = buildDashboardHtml();
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', `http://${host}`);
    if (requestUrl.pathname === '/api/state') {
      try {
        const body = JSON.stringify(options.getState());
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(body);
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }
    if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(liveHtml);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port || 0, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}/`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        }),
      });
    });
  });
}

module.exports = {
  buildDashboardHtml,
  startDashboardServer,
};
