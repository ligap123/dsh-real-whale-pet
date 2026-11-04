(() => {
  const api = window.settingsBridge, key = document.getElementById('key'), status = document.getElementById('status'), refresh = document.getElementById('refresh');
  const volume = document.getElementById('volume'), volumeValue = document.getElementById('volume-value'), mute = document.getElementById('mute');
  const select = style => document.querySelectorAll('[data-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.style === style)));
  function showAudio(audio) {
    const percent = Math.round(audio.masterVolume * 100);
    volume.value = percent; volumeValue.textContent = `${percent}%`;
    mute.textContent = audio.enabled ? '静音' : '取消静音';
    mute.setAttribute('aria-pressed', String(!audio.enabled));
  }
  api.state().then(state => {
    select(state.style);
    if (state.audio) showAudio(state.audio);
    if (state.hasKey) key.placeholder = '已在本机加密保存 · 留空使用';
    else if (state.balanceBridge) key.placeholder = '可留空 · 读 DSH 账号余额';
  }).catch(() => { status.textContent = '无法读取设置'; });
  document.querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', async () => {
    try { await api.style(button.dataset.style); select(button.dataset.style); }
    catch { status.textContent = '无法保存挂件设置'; }
  }));
  let volumeTimer;
  volume.addEventListener('input', () => {
    volumeValue.textContent = `${volume.value}%`;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(async () => {
      try { showAudio(await api.audio({ masterVolume: Number(volume.value) / 100 })); }
      catch { status.textContent = '无法保存音量'; }
    }, 180);
  });
  mute.addEventListener('click', async () => {
    try { showAudio(await api.audio({ enabled: mute.getAttribute('aria-pressed') === 'true' })); }
    catch { status.textContent = '无法保存静音设置'; }
  });
  document.getElementById('balance-form').addEventListener('submit', async event => {
    event.preventDefault(); refresh.disabled = true; status.textContent = '正在查询…';
    const entered = key.value.trim();
    try {
      const result = await api.balance(entered || undefined);
      key.value = '';
      if (result.error) { status.textContent = result.error; return; }
      const rows = result.data.rows;
      document.getElementById('amount').textContent = rows.map(row => `${row.currency === 'CNY' ? '¥' : '$'} ${row.total}`).join(' / ');
      document.getElementById('details').textContent = rows.map(row => `${row.currency} · 充值 ${row.toppedUp == null ? '—' : row.toppedUp} · 赠送 ${row.granted == null ? '—' : row.granted}`).join('\n');
      const source = result.data.source === 'account' ? 'DSH 账号' : 'API Key';
      const state = result.data.available === true ? '账户可用' : result.data.available === false ? '余额不足' : '已读取余额';
      status.textContent = `${state} · 来源：${source} · 更新于 ${new Date(result.data.updatedAt).toLocaleTimeString('zh-CN')}`;
      if (entered) key.placeholder = '已在本机加密保存 · 留空使用';
    } catch { key.value = ''; status.textContent = '无法查询余额，请重试'; }
    finally { refresh.disabled = false; }
  });
  document.getElementById('forget').addEventListener('click', async () => {
    try { await api.forget(); key.value = ''; key.placeholder = '可留空 · 读 DSH 账号余额'; status.textContent = '已删除本机保存的密钥'; document.getElementById('amount').textContent = '尚未查询'; document.getElementById('details').textContent = '留空直接刷新，或用 API Key 覆盖。'; }
    catch { status.textContent = '删除失败，请重试'; }
  });
})();
