// Prevent double-init (helps if file accidentally included twice)
if (window.__esp32IrHubAppInit) {
  console.warn("ESP32 IR Hub app.js already initialized");
} else {
  window.__esp32IrHubAppInit = true;

  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  let btnAllOn = null;
  let btnAllOff = null;
  let tabWifiBtn = null;
  let dashboardData = null;
let usageChart = null;
let currentRange = "week";

function formatThaiDate(ts){
 const d=new Date(Number(ts)*1000);
 return d.toLocaleString("th-TH");
}
function getLast7DayLabels()
{
    const labels = [];

    for(let i = 6; i >= 0; i--)
    {
        const d = new Date();

        d.setDate(d.getDate() - i);

        labels.push(
            d.toLocaleDateString(
                "th-TH",
                {
                    day: "2-digit",
                    month: "2-digit"
                }
            )
        );
    }

    return labels;
}


  // ===== status interval control (Option 2: smooth) =====
  let statusInterval = null;
  function startStatusInterval(){
    if(statusInterval) return;
    statusInterval = setInterval(refreshStatus, 700);
  }
  function stopStatusInterval(){
    if(!statusInterval) return;
    clearInterval(statusInterval);
    statusInterval = null;
  }

  // ===== Device Wizard state (B: step-by-step ON -> OFF) =====
  const devWizard = {
    active: false,
    phase: "idle", // idle | learning_on | learning_off | done | error
    deviceName: "",
    pollTimer: null,
    lastLearnStatus: null,
    expectedOnName: "",
    expectedOffName: "",
    startedUsedCount: 0,
  };
async function loadDashboard() {
try {
    const r = await fetch("/api/dashboard");
    const data = await r.json();

    document.getElementById("dash-today").innerHTML = data.today + `<div class="small">${data.todayTopDevice||"ไม่มีข้อมูล"}${data.todayTopCount?` (${data.todayTopCount})`:``}</div>`;
    document.getElementById("dash-week").innerHTML = data.week + `<div class="small">${data.weekTopDevice||"ไม่มีข้อมูล"}${data.weekTopCount?` (${data.weekTopCount})`:``}</div>`;
    document.getElementById("dash-month").innerHTML = data.month + `<div class="small">${data.monthTopDevice||"ไม่มีข้อมูล"}${data.monthTopCount?` (${data.monthTopCount})`:``}</div>`;

    dashboardData = data;

    updateChart();

    const tbody = document.getElementById("stats-table");

    if (tbody && data.devices) {

        tbody.innerHTML = "";

        data.devices.forEach(d => {

            tbody.innerHTML += `
<tr>
<td>${d.name}</td>
<td>${d.onCount}</td>
<td>${Number(d.minutes).toFixed(1)}</td>
<td>${Number(d.avgMinutes).toFixed(1)}</td>
</tr>`;

        });

    }
} catch(e){ console.error(e); }
}

  async function api(path, opts={}){
    const res = await fetch(path, opts);
    const txt = await res.text();
    let data = {};
    try { data = JSON.parse(txt); } catch { data = { ok:false, raw:txt }; }
    if(!res.ok) throw data;
    return data;
  }

  function escapeHtml(s){
    return (s||"").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  const WIFI_HISTORY_KEY = "wifi_history_v1";
  const WIFI_HISTORY_LIMIT = 5;

  function getSignalIcon(rssi){
    if(rssi >= -55) return "📶📶📶📶📶";
    if(rssi >= -65) return "📶📶📶📶";
    if(rssi >= -75) return "📶📶📶";
    if(rssi >= -85) return "📶📶";
    return "📶";
  }

  function getWifiHistory(){
    try{
      const parsed = JSON.parse(localStorage.getItem(WIFI_HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(v => typeof v === "string" && v.trim()) : [];
    }catch{
      return [];
    }
  }

  function saveWifiHistory(ssid){
    const trimmed = (ssid || "").trim();
    if(!trimmed) return;
    const next = [trimmed, ...getWifiHistory().filter(v => v !== trimmed)].slice(0, WIFI_HISTORY_LIMIT);
    localStorage.setItem(WIFI_HISTORY_KEY, JSON.stringify(next));
  }

  function renderWifiHistory(selected = ""){
    const history = getWifiHistory();
    const select = $("#wifi-history");
    if(!select) return;

    select.innerHTML = '<option value="">-- เลือกจากประวัติ --</option>';
    history.forEach(ssid => {
      const opt = document.createElement("option");
      opt.value = ssid;
      opt.textContent = ssid;
      select.appendChild(opt);
    });

    if(selected && history.includes(selected)){
      select.value = selected;
    }
  }

  function updateSelectedWifiLabel(ssid){
    const label = $("#wifi-selected-label");
    if(!label) return;
    const value = (ssid || "").trim();
    label.textContent = value ? `✅ เลือก: ${value}` : "✅ เลือก: —";
  }

  function selectWifiSsid(ssid){
    const value = (ssid || "").trim();
    const ssidInput = $("#wifi-ssid");
    if(ssidInput) ssidInput.value = value;
    updateSelectedWifiLabel(value);
  }

  function updateApToggleButton(apEnabled){
    const btn = $("#btn-ap-toggle");
    if(!btn) return;
    btn.textContent = apEnabled ? "ปิด AP Mode" : "เปิด AP Mode";
  }

  // ===== WiFi Status Display Update =====
  function updateWifiStatusDisplay(st){
    const icon = $("#wifi-status-icon");
    const text = $("#wifi-status-text");
    if(!icon || !text) return;

    if(st.wifi.sta_connected){
      icon.textContent = "✅";
      text.textContent = `เชื่อมต่อแล้ว • SSID: ${st.wifi.sta_ssid || "—"} • IP: ${st.wifi.sta_ip || "—"}`;
    }else{
      icon.textContent = "❌";
      text.textContent = "ยังไม่เชื่อมต่อ STA";
    }
  }

  /* =========================
     Device parsing
     Naming convention:
       DEVICE:ON
       DEVICE:OFF
     ========================= */

  function buildDevicesFromKeys(keys) {
    const devices = new Map();

    for (const k of keys) {
        if (!k.used) continue;

        const parts = (k.name || "").split(":");
        if (parts.length < 2) continue;

        const devName = parts[0].trim();
        const btnName = parts.slice(1).join(":").trim();

        if (!devices.has(devName)) {
            devices.set(devName, {
                name: devName,
                buttons: [],
                onSlot: null,
                offSlot: null
            });
        }

        const d = devices.get(devName);

        d.buttons.push({
            name: btnName,
            slot: k.slot
        });

        if (btnName.toUpperCase() === "ON")
            d.onSlot = k.slot;

        if (btnName.toUpperCase() === "OFF")
            d.offSlot = k.slot;
    }

    return [...devices.values()];
}

  function setVisible(el, yes){
    if(!el) return;
    el.style.display = yes ? "" : "none";
  }
/* =========================
   Tabs
   ========================= */

function setTab(tabName){

  document
    .querySelectorAll(".panel")
    .forEach(p => p.classList.remove("show"));

  document
    .querySelectorAll(".tab")
    .forEach(t => t.classList.remove("active"));

  const panel =
    document.getElementById(`tab-${tabName}`);

  if(panel)
    panel.classList.add("show");

  const tabBtn =
    document.querySelector(
      `.tab[data-tab="${tabName}"]`
    );

  if(tabBtn)
    tabBtn.classList.add("active");

  if(tabName === "dashboard"){
    loadDashboard().catch(console.error);
  }

  if(tabName === "history"){
    loadHistory().catch(console.error);
  }

  if(tabName === "stats"){
    loadDashboard().catch(console.error);
  }
}

function initTabs(){

  document
    .querySelectorAll(".tab")
    .forEach(btn => {

      btn.addEventListener("click", () => {

        const tab =
          btn.dataset.tab;

        if(tab)
          setTab(tab);

      });

    });
}
  function updateWifiTabVisibilityFromStatus(st){
    if(!tabWifiBtn) return;
    setVisible(tabWifiBtn, true);
  }

  function updateAdvancedLearnVisibility(hasDevice){
    const advancedDetails = $("#advanced-learn-details");
    if(!advancedDetails) return;
    
    if(hasDevice){
      advancedDetails.style.display = "";
    }else{
      advancedDetails.style.display = "none";
      // ปิด details ถ้าเปิดอยู่
      advancedDetails.open = false;
    }
  }

  // ===== Advanced Learn Device Selection =====
  async function updateDeviceSelectDropdown(){
    const select = $("#device-select");
    if(!select) return;
    
    const keysData = await api("/api/keys");
    const devices = buildDevicesFromKeys(keysData.keys || []);
    
    // เก็บค่าเดิม
    const prevValue = select.value;
    
    // ล้างตัวเลือก (เก็บ placeholder ไว้)
    select.innerHTML = '<option value="">-- เลือกอุปกรณ์ --</option>';
    
    // เพิ่มอุปกรณ์
    devices.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.name;
      opt.textContent = d.name;
      select.appendChild(opt);
    });
    
    // คืนค่าเดิมถ้ายังอยู่
    select.value = prevValue;
    
    // Disable/Enable ปุ่มเริ่มตามสถานะ
    updateLearnButtonState();
  }

  function updateLearnButtonState(){
    const deviceSelect = $("#device-select");
    const learnName = $("#learn-name");
    const btnStart = $("#btn-learn-start");
    
    if(!btnStart) return;
    
    // Enable ปุ่มได้เมื่อ: เลือกอุปกรณ์ + ใส่ชื่อปุ่ม
    const hasDevice = deviceSelect && deviceSelect.value !== "";
    const hasName = learnName && learnName.value.trim() !== "";
    
    btnStart.disabled = !(hasDevice && hasName);
  }

  async function updateUiByDevices(keysDataMaybe){
    const keysData = keysDataMaybe || await api("/api/keys");
    const devices = buildDevicesFromKeys(keysData.keys || []);
    const hasDevice = devices.length > 0;

    setVisible(btnAllOn, hasDevice);
    setVisible(btnAllOff, hasDevice);

    // อัพเดต device dropdown
    await updateDeviceSelectDropdown();
    updateAdvancedLearnVisibility(hasDevice);

    const statusPanel = $("#tab-status");
    if(!hasDevice && statusPanel && statusPanel.classList.contains("show")){
      setTab("dashboard");
    }

    if(btnAllOn) btnAllOn.textContent = hasDevice ? `เปิดทั้งหมด (${devices.length})` : "เปิดทั้งหมด";
    if(btnAllOff) btnAllOff.textContent = hasDevice ? `ปิดทั้งหมด (${devices.length})` : "ปิดทั้งหมด";
  }

  /* =========================
     UI cards
     ========================= */

  function keyCard(k){
    const div = document.createElement("div");
    div.className = "card key";

    const title = document.createElement("div");
    title.className = "top";
    title.innerHTML = `
      <div>
        <div style="font-weight:700">${escapeHtml(k.name)}</div>
        <div class="small">${k.used ? "บันทึกแล้ว" : "ว่าง"}</div>
      </div>
      <div class="badge">${k.id}</div>
    `;

    const row = document.createElement("div");
    row.className = "row";

    const btnSend = document.createElement("button");
    btnSend.className = "btn primary";
    btnSend.textContent = "ส่ง";
    btnSend.disabled = !k.used;
    btnSend.onclick = async () => {
      btnSend.disabled = true;
      try{
        await api(`/api/send?slot=${k.slot}`, { method:"POST" });
        btnSend.textContent = "ส่งแล้ว";
        setTimeout(()=> btnSend.textContent="ส่ง", 900);
      }catch(e){
        alert(`ส่งไม่สำเร็จ: ${e.error || JSON.stringify(e)}`);
      }finally{
        btnSend.disabled = !k.used;
      }
    };

    const btnDel = document.createElement("button");
    btnDel.className = "btn danger";
    btnDel.textContent = "ลบ";
    btnDel.disabled = !k.used;
    btnDel.onclick = async () => {
      if(!confirm(`ลบ "${k.name}" ?`)) return;
      btnDel.disabled = true;
      try{
        await api(`/api/delete?slot=${k.slot}`, { method:"POST" });
        await refreshKeys();
      }catch(e){
        alert(`ลบไม่สำเร็จ: ${e.error || JSON.stringify(e)}`);
      }finally{
        btnDel.disabled = false;
      }
    };

    row.append(btnSend, btnDel);
    div.append(title, row);
    return div;
  }

  function deviceCard(d){
    const div = document.createElement("div");
    div.className = "card device";

    const title = document.createElement("div");
    title.className = "top";
    title.innerHTML = `
      <div>
        <div style="font-weight:700">${escapeHtml(d.name)}</div>
        <div class="small">อุปกรณ์ IR</div>
      </div>
    `;

    div.appendChild(title);

    const row = document.createElement("div");
    row.className = "row";

    // ===== สร้างปุ่มทั้งหมดของอุปกรณ์ =====
    d.buttons.forEach(btn => {

        const b = document.createElement("button");

        const upper = btn.name.toUpperCase();

        if (upper === "ON") {
            b.className = "btn primary";
            b.textContent = "เปิด";
        }
        else if (upper === "OFF") {
            b.className = "btn danger";
            b.textContent = "ปิด";
        }
        else {
            b.className = "btn";
            b.textContent = btn.name;
        }

        b.onclick = async () => {
            b.disabled = true;
            try {
                await api(`/api/send?slot=${btn.slot}`, {
                    method: "POST"
                });

                const old = b.textContent;
                b.textContent = "ส่งแล้ว";

                setTimeout(() => {
                    b.textContent = old;
                }, 800);

            } catch (e) {
                alert(`ส่งไม่สำเร็จ: ${e.error || JSON.stringify(e)}`);
            } finally {
                b.disabled = false;
            }
        };

        row.appendChild(b);
    });

    // ===== ปุ่มลบอุปกรณ์ =====
    const btnDel = document.createElement("button");
    btnDel.className = "btn danger";
    btnDel.textContent = "ลบ";

    btnDel.onclick = async () => {

        if (!confirm(`ลบ "${d.name}" ทั้งหมด?`))
            return;

        btnDel.disabled = true;

        try {

            // ลบทุกปุ่มของอุปกรณ์
            for (const btn of d.buttons) {
                await api(`/api/delete?slot=${btn.slot}`, {
                    method: "POST"
                });
            }

            await refreshKeys();

            alert("ลบสำเร็จ");

        } catch (e) {

            alert(`ลบไม่สำเร็จ: ${e.error || JSON.stringify(e)}`);

        } finally {

            btnDel.disabled = false;

        }

    };

    row.appendChild(btnDel);

    div.appendChild(row);

    return div;
}

  /* =========================
     API: keys/status
     ========================= */

  async function refreshKeys(){
    const box = $("#keys-list");
    box.innerHTML = "";

    const data = await api("/api/keys");
    const usedKeys = (data.keys || []).filter(k => k.used);

    if(usedKeys.length === 0){
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `
        <div style="font-weight:700; font-size:18px">ยังไม่มีอุปกรณ์</div>
        <div class="small" style="margin-top:6px">
          ไปที่แท็บ "เรียนรู้" แล้วกด "เริ่มเพิ่มอุปกรณ์" (เปิด → ปิด)
        </div>
        <div class="row" style="margin-top:12px">
          <button id="btn-go-learn" class="btn primary">ไปหน้าเรียนรู้</button>
        </div>
      `;
      box.appendChild(empty);

      const go = empty.querySelector("#btn-go-learn");
      if(go) go.addEventListener("click", ()=> setTab("learn"));
    }else{
      const devices = buildDevicesFromKeys(data.keys || []);
      if(devices.length > 0){
        devices.forEach(d => box.appendChild(deviceCard(d)));
      }else{
        usedKeys.forEach(k => box.appendChild(keyCard(k)));
      }
    }

    await updateUiByDevices(data);
    return data;
  }

  async function refreshStatus(){
    const st = await api("/api/status");
    
    // ⭐ เพิ่ม null check
    const statusBox = $("#status-box");
    if(statusBox) statusBox.textContent = JSON.stringify(st, null, 2);

    // manual learn UI
    const learnPill = $("#learn-pill");
    const learnProg = $("#learn-progress");
    if(learnPill) learnPill.textContent = st.learn.status;
    if(learnProg){
      learnProg.textContent = st.learn.active
        ? `รับแล้ว ${st.learn.got}/${st.learn.need} • เหลือ ${Math.ceil(st.learn.remaining_ms/1000)}s`
        : `พร้อมใช้งาน`;
    }

    // wifi UI
    const apEnabled = !!st.wifi.ap_enabled;
    const wifiLine = `AP(${apEnabled ? "ON" : "OFF"}): ${st.wifi.ap_ip || "—"} • STA: ${st.wifi.sta_connected ? st.wifi.sta_ip : "not connected"}`;
    const wifiState = $("#wifi-state");
    if(wifiState) wifiState.textContent = wifiLine;
    const wifiLive = $("#wifi-live-status");
    if(wifiLive){
      wifiLive.textContent = st.wifi.sta_connected
        ? `เชื่อมต่อแล้ว • SSID: ${st.wifi.sta_ssid || "—"} • IP: ${st.wifi.sta_ip || "—"}`
        : "ยังไม่เชื่อมต่อ STA";
    }
    
    // Update the new WiFi status display
    updateWifiStatusDisplay(st);
    
    updateApToggleButton(apEnabled);

    updateWifiTabVisibilityFromStatus(st);
    return st;
  }

  /* =========================
     Global ON/OFF (All devices)
     ========================= */

  async function apiSendSlot(slot){
    const res = await fetch(`/api/send?slot=${encodeURIComponent(String(slot))}`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if(!res.ok || j.ok === false) throw new Error(j.error || `send_failed_${res.status}`);
    return j;
  }

  async function sendAllPower(mode /* "ON" | "OFF" */){
    const keysData = await api("/api/keys");
    const devices = buildDevicesFromKeys(keysData.keys || []);

    if(devices.length === 0){
      alert("ยังไม่มีอุปกรณ์ที่เพิ่มครบ (ต้องมีเปิด/ปิด)");
      return;
    }

    const delayMs = 300;
    for(const d of devices){
      const slot = (mode === "ON") ? d.onSlot : d.offSlot;
      try{
        await apiSendSlot(slot);
      }catch(e){
        console.warn(`send ${mode} failed for ${d.name}`, e);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }

    alert(`${mode === "ON" ? "เปิด" : "ปิด"}ทั้งหมดแล้ว (${devices.length} อุปกรณ์)`);
  }

  function setupAllButtons(){
    btnAllOn = $("#btn-all-on");
    btnAllOff = $("#btn-all-off");
    tabWifiBtn = $("#tab-wifi-btn");

    setVisible(btnAllOn, false);
    setVisible(btnAllOff, false);

    if(btnAllOn){
      btnAllOn.addEventListener("click", async ()=>{
        btnAllOn.disabled = true;
        try{ await sendAllPower("ON"); }
        catch(e){ alert(`เปิดทั้งหมดไม่สำเร็จ: ${e.message || e}`); }
        finally{
          btnAllOn.disabled = false;
          await updateUiByDevices();
        }
      });
    }

    if(btnAllOff){
      btnAllOff.addEventListener("click", async ()=>{
        btnAllOff.disabled = true;
        try{ await sendAllPower("OFF"); }
        catch(e){ alert(`ปิดทั้งหมดไม่สำเร็จ: ${e.message || e}`); }
        finally{
          btnAllOff.disabled = false;
          await updateUiByDevices();
        }
      });
    }

    updateUiByDevices().catch(()=>{});
  }

  /* =========================
     Device Wizard (Primary UX)
     ========================= */

  function normalizeDeviceName(s){
    return (s || "").trim().replace(/\s+/g, " ");
  }

  function devWizardLockUI(locked){
    const nameInput = $("#dev-name");
    const btnStart = $("#btn-dev-start");
    if(nameInput) nameInput.disabled = locked;
    if(btnStart) btnStart.disabled = locked;
  }

  function setDevWizardUI({ pill, step, tip }){
    const p = $("#dev-pill");
    const s = $("#dev-step");
    const t = $("#dev-tip");
    if(p && pill != null) p.textContent = pill;
    if(s && step != null) s.textContent = step;
    if(t && tip != null) t.textContent = tip;
  }

  async function devStartLearning(nameForKey){
    await api(`/api/learn/start?name=${encodeURIComponent(nameForKey)}`, { method:"POST" });
    await refreshStatus();
  }

  async function hasSavedKeyExact(name){
    const kd = await api("/api/keys");
    const found = (kd.keys || []).some(k => k.used && (k.name || "").trim() === name);
    return found;
  }

  function devWizardStopPolling(){
    if(devWizard.pollTimer){
      clearInterval(devWizard.pollTimer);
      devWizard.pollTimer = null;
    }
  }

  function devWizardStartPolling(){
    devWizardStopPolling();
    devWizard.pollTimer = setInterval(devWizardPoll, 600);
  }

  async function devWizardStart(){
    if(devWizard.active) return;

    const dn = normalizeDeviceName($("#dev-name")?.value);
    if(!dn){ alert("กรุณาใส่ชื่ออุปกรณ์ก่อน"); return; }

    const keys0 = await api("/api/keys");
    devWizard.startedUsedCount = (keys0.keys || []).filter(k => k.used).length;

    devWizard.active = true;
    stopStatusInterval();
    devWizardLockUI(true);

    devWizard.deviceName = dn;
    devWizard.phase = "learning_on";
    devWizard.lastLearnStatus = null;
    devWizard.expectedOnName = `${dn}:ON`;
    devWizard.expectedOffName = `${dn}:OFF`;

    setDevWizardUI({
      pill: "เริ่มแล้ว",
      step: `ขั้นตอน 1/2: ปุ่ม "เปิด"`,
      tip: `กำลังเริ่มเรียนรู้ ${devWizard.expectedOnName}…`,
    });

    try{
      await devStartLearning(devWizard.expectedOnName);
      setDevWizardUI({
        pill: "รอรีโมท",
        step: `ขั้นตอน 1/2: ปุ่ม "เปิด"`,
        tip: "กดปุ่มเปิดจากรีโมทเดิม 3 ครั้ง (ให้เหมือนกัน)",
      });
    }catch(e){
      devWizard.active = false;
      devWizard.phase = "error";
      devWizardLockUI(false);
      startStatusInterval();
      setDevWizardUI({ pill:"ผิดพลาด", tip:"เริ่มเรียนรู้ไม่สำเร็จ" });
      alert(`เริ่มเรียนรู้ (ON) ไม่ได้: ${e.error || JSON.stringify(e)}`);
      return;
    }

    devWizardStartPolling();
  }

  async function devWizardCancel(){
    try{ await api(`/api/learn/cancel`, { method:"POST" }); } catch {}

    devWizardStopPolling();
    devWizard.active = false;
    devWizard.phase = "idle";
    devWizard.deviceName = "";
    devWizard.lastLearnStatus = null;

    devWizardLockUI(false);
    setDevWizardUI({ pill:"พร้อม", step:"—", tip:"ยกเลิกแล้ว" });

    await refreshStatus();
    startStatusInterval();
  }

  async function devWizardFail(message){
    devWizardStopPolling();
    devWizard.active = false;
    devWizard.phase = "error";

    devWizardLockUI(false);
    startStatusInterval();

    setDevWizardUI({ pill:"ผิดพลาด", tip: message });
    alert(message);
  }

  async function devWizardDone(){
    devWizardStopPolling();
    devWizard.active = false;
    devWizard.phase = "done";

    devWizardLockUI(false);
    startStatusInterval();

    setDevWizardUI({
      pill: "สำเร็จ",
      step: `เพิ่มอุปกรณ์สำเร็จ: ${devWizard.deviceName}`,
      tip: "ไปที่แท็บ \"ปุ่ม\" เพื่อใช้งานได้เลย",
    });

    await refreshKeys();
  }

  async function devWizardPoll(){
    if(!devWizard.active) return;

    let st;
    try{
      st = await api("/api/status");
    }catch{
      return;
    }

    const statusBox = $("#status-box");
    if(statusBox) statusBox.textContent = JSON.stringify(st, null, 2);

    const remainS = Math.ceil(st.learn.remaining_ms / 1000);
    if(st.learn.active){
      setDevWizardUI({
        pill: "กำลังเรียนรู้",
        tip: `รับแล้ว ${st.learn.got}/${st.learn.need} • เหลือ ${remainS}s`,
      });
    }else{
      setDevWizardUI({ pill: st.learn.status });
    }

    updateWifiTabVisibilityFromStatus(st);

    const learnStatus = st.learn.status;

    if(devWizard.lastLearnStatus === learnStatus && learnStatus !== "saved") return;
    devWizard.lastLearnStatus = learnStatus;

    if(["timeout","mismatch_try_again","save_failed","error"].includes(learnStatus)){
      await devWizardFail(`เรียนรู้ไม่สำเร็จ: ${learnStatus}\nลองใหม่อีกครั้ง`);
      return;
    }

    if(learnStatus === "saved"){
      await refreshKeys();

      if(devWizard.phase === "learning_on"){
        const okOn = await hasSavedKeyExact(devWizard.expectedOnName);
        if(!okOn){
          await devWizardFail(`บันทึกไม่สำเร็จ (ไม่พบ ${devWizard.expectedOnName})\nกรุณาลองใหม่`);
          return;
        }

        devWizard.phase = "learning_off";
        devWizard.lastLearnStatus = null;

        setDevWizardUI({
          pill: "รอรีโมท",
          step: `ขั้นตอน 2/2: ปุ่ม "ปิด"`,
          tip: `เริ่มเรียนรู้ ${devWizard.expectedOffName}…`,
        });

        try{
          await devStartLearning(devWizard.expectedOffName);
          setDevWizardUI({
            pill: "รอรีโมท",
            step: `ขั้นตอน 2/2: ปุ่ม "ปิด"`,
            tip: "กดปุ่มปิดจากรีโมทเดิม 3 ครั้ง (ให้เหมือนกัน)",
          });
        }catch(e){
          await devWizardFail(`เริ่มเรียนรู้ (OFF) ไม่ได้: ${e.error || JSON.stringify(e)}`);
          return;
        }

        return;
      }

      if(devWizard.phase === "learning_off"){
        const okOff = await hasSavedKeyExact(devWizard.expectedOffName);
        if(!okOff){
          await devWizardFail(`บันทึกไม่สำเร็จ (ไม่พบ ${devWizard.expectedOffName})\nกรุณาลองใหม่`);
          return;
        }

        await devWizardDone();
        return;
      }

      await devWizardFail("สถานะ wizard ผิดปกติ กรุณาลองใหม่");
    }
  }

  /* =========================
     Advanced manual learn
     ========================= */

  $("#device-select")?.addEventListener("change", updateLearnButtonState);

  $("#learn-name")?.addEventListener("input", updateLearnButtonState);

  // ⭐ แก้ไข: Advanced Learn - auto refresh เมื่อเสร็จ
  $("#btn-learn-start")?.addEventListener("click", async ()=>{
    const deviceSelect = $("#device-select");
    const learnName = $("#learn-name");
    const btnStart = $("#btn-learn-start");
    
    if(!deviceSelect?.value) {
      alert("กรุณาเลือกอุปกรณ์ก่อน");
      return;
    }
    
    const name = (learnName?.value || "").trim();
    if(!name) {
      alert("กรุณาใส่ชื่อปุ่ม");
      return;
    }
    
    const fullName = `${deviceSelect.value}:${name}`;
    
    try{
      btnStart.disabled = true;
      btnStart.textContent = "⏳ กำลังเรียนรู้...";
      
      await api(`/api/learn/start?name=${encodeURIComponent(fullName)}`, { method:"POST" });
      await refreshStatus();
      
      // ⭐ รอให้เรียนรู้เสร็จ และ auto refresh
      let learned = false;
      for(let i = 0; i < 15; i++){  // รอสูงสุด 15 วินาที (10 วินาที timeout + buffer)
        await new Promise(r => setTimeout(r, 800));
        const st = await api("/api/status");
        
        if(!st.learn.active && st.learn.status === "saved"){
          // ✅ เรียนรู้เสร็จแล้ว!
          learned = true;
          break;
        }
        
        if(st.learn.status === "timeout" || st.learn.status === "mismatch_try_again"){
          // ❌ เรียนรู้ล้มเหลว
          break;
        }
      }
      
      // ⭐ Auto refresh การ์ด
      await refreshKeys();
      await refreshStatus();
      
      if(learned){
        alert(`เรียนรู้ "${fullName}" สำเร็จ! ✅`);
        // ล้างฟอร์ม
        learnName.value = "";
        updateLearnButtonState();
      }else{
        alert("เรียนรู้ไม่สำเร็จ กรุณาลองใหม่");
      }
    }catch(e){
      alert(`เริ่มไม่ได้: ${e.error || JSON.stringify(e)}`);
    }finally{
      btnStart.disabled = false;
      btnStart.textContent = "เริ่มเรียนรู้";
    }
  });

  $("#btn-learn-cancel")?.addEventListener("click", async ()=>{
    try{
      await api(`/api/learn/cancel`, { method:"POST" });
      await refreshStatus();
    }catch(e){
      alert(`ยกเลิกไม่ได้: ${e.error || JSON.stringify(e)}`);
    }
  });

  /* =========================
     WiFi
     ========================= */

  $("#btn-wifi-scan")?.addEventListener("click", async ()=>{
    const btn = $("#btn-wifi-scan");
    const list = $("#wifi-list");
    const status = $("#scan-status");
    if(!btn || !list || !status) return;

    btn.disabled = true;
    btn.textContent = "⏳ กำลังค้นหา...";
    status.textContent = "กำลังค้นหา WiFi รอบตัว...";
    list.innerHTML = '<option value="">-- กำลังค้นหา --</option>';

    try{
      const res = await api("/api/wifi/scan");
      const networks = Array.isArray(res.networks) ? res.networks : [];
      list.innerHTML = '<option value="">-- เลือก WiFi ที่พบ --</option>';

      networks.forEach((n)=>{
        const ssid = (n.ssid || "").trim();
        const rssi = Number.isFinite(Number(n.rssi)) ? Number(n.rssi) : -100;
        const label = ssid || "(hidden)";
        const opt = document.createElement("option");
        opt.value = ssid;
        opt.textContent = `${getSignalIcon(rssi)} ${label} (${rssi} dBm)`;
        opt.disabled = !ssid;
        list.appendChild(opt);
      });

      status.textContent = `พบ ${networks.length} เครือข่าย`;
    }catch(e){
      status.textContent = "ค้นหาไม่สำเร็จ";
      alert(`ค้นหา WiFi ไม่ได้: ${e.error || JSON.stringify(e)}`);
    }finally{
      btn.textContent = "🔍 ค้นหา WiFi";
      btn.disabled = false;
    }
  });

  $("#wifi-list")?.addEventListener("change", (ev)=>{
    const selected = ev?.target?.value || "";
    selectWifiSsid(selected);
  });

  $("#wifi-history")?.addEventListener("change", (ev)=>{
    const selected = ev?.target?.value || "";
    selectWifiSsid(selected);
  });

  $("#wifi-ssid")?.addEventListener("input", (ev)=>{
    updateSelectedWifiLabel(ev?.target?.value || "");
  });

  // Refresh WiFi status manually
  $("#btn-wifi-refresh-status")?.addEventListener("click", refreshStatus);

  $("#btn-wifi-load")?.addEventListener("click", async ()=>{
    try{
      const w = await api("/api/wifi/get");
      $("#wifi-ssid").value = w.sta_ssid || "";
      $("#wifi-pass").value = "";
      updateSelectedWifiLabel(w.sta_ssid || "");
      renderWifiHistory(w.sta_ssid || "");
      updateApToggleButton(!!w.ap_enabled);
      $("#wifi-state").textContent = `AP(${w.ap_enabled ? "ON" : "OFF"}): ${w.ap_ip || "—"} • STA: ${w.sta_connected ? w.sta_ip : "not connected"}`;
      const wifiLive = $("#wifi-live-status");
      if(wifiLive){
        wifiLive.textContent = w.sta_connected
          ? `เชื่อมต่อแล้ว • SSID: ${w.sta_ssid || "—"} • IP: ${w.sta_ip || "—"}`
          : "ยังไม่เชื่อมต่อ STA";
      }
    }catch(e){
      alert(`โหลดไม่ได้: ${e.error || JSON.stringify(e)}`);
    }
  });

  $("#btn-wifi-logout")?.addEventListener("click", async ()=>{
    if(!confirm("ต้องการตัดการเชื่อมต่อ WiFi ใช่ไหม?")) return;
    try{
      await api("/api/wifi/disconnect", { method:"POST" });
      $("#wifi-pass").value = "";
      await refreshStatus();
      alert("ตัดการเชื่อมต่อ WiFi แล้ว");
    }catch(e){
      alert(`ตัดการเชื่อมต่อไม่ได้: ${e.error || JSON.stringify(e)}`);
    }
  });

  $("#btn-ap-toggle")?.addEventListener("click", async ()=>{
    try{
      const res = await api("/api/wifi/toggle-ap", { method:"POST" });
      updateApToggleButton(!!res.ap_enabled);
      await refreshStatus();
    }catch(e){
      alert(`สลับ AP Mode ไม่ได้: ${e.error || JSON.stringify(e)}`);
    }
  });

  $("#btn-wifi-save")?.addEventListener("click", async ()=>{
    const ssid = ($("#wifi-ssid").value || "").trim();
    const pass = ($("#wifi-pass").value || "");
    if(!ssid){ alert("กรุณาใส่ SSID"); return; }
    try{
      await api(`/api/wifi/set?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`, { method:"POST" });
      saveWifiHistory(ssid);
      renderWifiHistory(ssid);
      updateSelectedWifiLabel(ssid);
      alert("บันทึกแล้ว! กำลังเชื่อมต่อ...");
      
      for(let i = 0; i < 30; i++){
        await new Promise(r => setTimeout(r, 500));
        const st = await api("/api/status");
        if(st.wifi.sta_connected){
          await refreshStatus();
          await refreshKeys();
          setTab("dashboard");
          break;
        }
      }
    }catch(e){
      alert(`บันทึกไม่ได้: ${e.error || JSON.stringify(e)}`);
    }
  });
async function loadHistory() {

    const r = await fetch("/api/history");
    const txt = await r.text();

    const historyList =
        document.getElementById("history-list");

    const lines = txt.trim().split("\n");

    if (lines.length <= 1) {
        historyList.innerHTML =
            "<div>ยังไม่มีข้อมูล</div>";
        return;
    }

    let html =
        '<table class="table"><tbody>';

    for(let i=1;i<lines.length;i++)
    {
        const c = lines[i].split(",");

        html += `
        <tr>
            <td>${formatThaiDate(c[0])}</td>
            <td>${c[1]}</td>
            <td>${c[2]}</td>
        </tr>`;
    }

    html += "</tbody></table>";

    historyList.innerHTML = html;
}
function drawChart(labels,data,title)
{
    const ctx =
        document
        .getElementById("weekChart")
        .getContext("2d");

    if(usageChart)
        usageChart.destroy();

    usageChart = new Chart(ctx,{
        type:"bar",

        data:{
            labels,
            datasets:[{
                label:title,
                data,
                borderRadius:10
            }]
        },

        options:{
            responsive:true,
            maintainAspectRatio:false,

            plugins:{
                legend:{
                    display:false
                }
            }
        }
    });
}
function updateChart()
{
    if(!dashboardData)
        return;

    if(currentRange==="day")
    {
        drawChart(
            ["วันนี้"],
            [dashboardData.today],
            "วันนี้"
        );
    }

    else if(currentRange==="week")
    {
        drawChart(
            getLast7DayLabels(),
            dashboardData.weekGraph,
            "สัปดาห์"
        );
    }

    else if(currentRange==="month")
    {
       drawChart(
    getLast30DayLabels(),
    dashboardData.monthGraph,
    "30 วันย้อนหลัง"
);
    }
}
function getLast30DayLabels()
{
    const labels=[];

    for(let i=29;i>=0;i--)
    {
        const d=new Date();

        d.setDate(d.getDate()-i);

        labels.push(
            d.toLocaleDateString(
                "th-TH",
                {
                    day:"2-digit",
                    month:"2-digit"
                }
            )
        );
    }

    return labels;
}
  /* =========================
     Buttons
     ========================= */

  $("#btn-refresh")?.addEventListener("click", refreshKeys);
  $("#btn-status")?.addEventListener("click", refreshStatus);

  /* =========================
     Init
     ========================= */

  (async ()=>{

    initTabs();

    setTab("dashboard");

    setupAllButtons();
    document
    .querySelectorAll(".segment-btn")
    .forEach(btn => {

      btn.addEventListener("click", () => {

        document
        .querySelectorAll(".segment-btn")
        .forEach(x => x.classList.remove("active"));

        btn.classList.add("active");

        currentRange = btn.dataset.range;

        updateChart();

      });
    });
    renderWifiHistory();
    updateSelectedWifiLabel($("#wifi-ssid")?.value || "");

    $("#btn-dev-start")?.addEventListener("click", devWizardStart);
    $("#btn-dev-cancel")?.addEventListener("click", devWizardCancel);
    setDevWizardUI({ pill:"พร้อม", step:"—", tip:"กดเริ่ม แล้วระบบจะรอรับสัญญาณจากรีโมท" });

    await refreshKeys();
    await refreshStatus();
    await loadDashboard();
    startStatusInterval();
  })();
}


async function renderWifiConnectionInfo(){
 try{
   const r=await fetch('/api/status');
   const s=await r.json();
   const el=document.getElementById('wifi-current-info');
   if(!el) return;
   if(s.wifi && s.wifi.sta_connected){
      el.textContent='📶 '+s.wifi.sta_ssid+' ('+s.wifi.sta_ip+')';
   }else{
      el.textContent='ไม่ได้เชื่อมต่อ Wi‑Fi';
   }
 }catch(e){}
}
setInterval(renderWifiConnectionInfo,5000);
document.addEventListener('DOMContentLoaded',renderWifiConnectionInfo);
