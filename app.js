// ระบบจัดการข้อมูล
class DataManager {
    constructor() {
        this.loadData();
        this.cleanOldData();
        this.initCharts();
    }

    loadData() {
        const historyData = localStorage.getItem('buttonHistory');
        const statsData = localStorage.getItem('deviceStats');
        
        this.history = historyData ? JSON.parse(historyData) : [];
        this.stats = statsData ? JSON.parse(statsData) : {};
    }

    saveData() {
        localStorage.setItem('buttonHistory', JSON.stringify(this.history));
        localStorage.setItem('deviceStats', JSON.stringify(this.stats));
    }

    addHistory(device, status) {
        const now = new Date();
        const timestamp = now.toLocaleString('th-TH');
        
        this.history.push({
            device: device,
            status: status,
            timestamp: timestamp,
            date: now.toISOString()
        });

        // เพิ่มเฉพาะ ON และนับครั้ง
        if (status === 'on') {
            if (!this.stats[device]) {
                this.stats[device] = {
                    device: device,
                    onCount: 0,
                    offCount: 0,
                    lastAction: ''
                };
            }
            this.stats[device].onCount++;
            this.stats[device].lastAction = timestamp;
        } else if (status === 'off') {
            if (!this.stats[device]) {
                this.stats[device] = {
                    device: device,
                    onCount: 0,
                    offCount: 0,
                    lastAction: ''
                };
            }
            this.stats[device].offCount++;
            this.stats[device].lastAction = timestamp;
        }

        this.saveData();
    }

    cleanOldData() {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        this.history = this.history.filter(item => {
            const itemDate = new Date(item.date);
            return itemDate > thirtyDaysAgo;
        });

        this.saveData();
    }

    getHistory() {
        return this.history;
    }

    getStats() {
        return this.stats;
    }

    clearHistory() {
        this.history = [];
        this.stats = {};
        this.saveData();
    }

    initCharts() {
        this.onOffChart = null;
        this.deviceChart = null;
    }
}

// สร้างตัวจัดการข้อมูล
const dataManager = new DataManager();

// ฟังก์ชันสำหรับบันทึกการกระทำ
function recordAction(device, status) {
    dataManager.addHistory(device, status);
    
    const statusText = status === 'on' ? '✅ เปิด' : '❌ ปิด';
    document.getElementById('lastStatus').textContent = `${device} - ${statusText} เมื่อเวลา ${new Date().toLocaleTimeString('th-TH')}`;
    
    updateHistory();
    updateStatistics();
    updateGraphs();
    
    // แสดงการแจ้งเตือน
    showNotification(`${device} ${statusText}`);
}

// ฟังก์ชันสำหรับแสดงการแจ้งเตือน
function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        z-index: 1000;
        animation: slideIn 0.3s ease-in;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

// ฟังก์ชันสำหรับอัปเดตประวัติ
function updateHistory() {
    const historyList = document.getElementById('historyList');
    const history = dataManager.getHistory();
    
    if (history.length === 0) {
        historyList.innerHTML = '<p class="empty">ยังไม่มีประวัติ</p>';
        return;
    }
    
    historyList.innerHTML = history
        .reverse()
        .map(item => {
            const statusIcon = item.status === 'on' ? '🟢' : '🔴';
            return `
                <div class="history-item">
                    <div>
                        <span class="history-item-name">${statusIcon} ${item.device}</span>
                        <div class="history-item-time">${item.timestamp}</div>
                    </div>
                    <div>${item.status === 'on' ? 'เปิด' : 'ปิด'}</div>
                </div>
            `;
        })
        .join('');
}

// ฟังก์ชันสำหรับอัปเดตสถิติ
function updateStatistics() {
    const statsGrid = document.getElementById('statsGrid');
    const stats = dataManager.getStats();
    
    if (Object.keys(stats).length === 0) {
        statsGrid.innerHTML = '<p class="empty">ยังไม่มีข้อมูลสถิติ</p>';
        return;
    }
    
    statsGrid.innerHTML = Object.values(stats)
        .map(item => `
            <div class="stat-card">
                <div class="stat-device">📊 ${item.device}</div>
                <div>
                    <div class="stat-label">ครั้งที่เปิด</div>
                    <div class="stat-value">${item.onCount}</div>
                </div>
                <div>
                    <div class="stat-label">ครั้งที่ปิด</div>
                    <div class="stat-value">${item.offCount}</div>
                </div>
                <div class="stat-label">ล่าสุด: ${item.lastAction || '-'}</div>
            </div>
        `)
        .join('');
}

// ฟังก์ชันสำหรับอัปเดตกราฟ
function updateGraphs() {
    const stats = dataManager.getStats();
    
    if (Object.keys(stats).length === 0) {
        return;
    }

    // กราฟ ON/OFF
    const devices = Object.keys(stats);
    const onCounts = devices.map(d => stats[d].onCount);
    const offCounts = devices.map(d => stats[d].offCount);
    
    const onOffCtx = document.getElementById('onOffChart');
    if (dataManager.onOffChart) {
        dataManager.onOffChart.destroy();
    }
    
    dataManager.onOffChart = new Chart(onOffCtx, {
        type: 'bar',
        data: {
            labels: devices,
            datasets: [
                {
                    label: 'ครั้งที่เปิด (ON)',
                    data: onCounts,
                    backgroundColor: '#4CAF50',
                    borderColor: '#45a049',
                    borderWidth: 1
                },
                {
                    label: 'ครั้งที่ปิด (OFF)',
                    data: offCounts,
                    backgroundColor: '#FF6B6B',
                    borderColor: '#ff5252',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        font: {
                            size: 12
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });

    // กราฟรายละเอียดอุปกรณ์
    const totalActions = devices.map(d => stats[d].onCount + stats[d].offCount);
    
    const deviceCtx = document.getElementById('deviceChart');
    if (dataManager.deviceChart) {
        dataManager.deviceChart.destroy();
    }
    
    const colors = [
        '#667eea',
        '#764ba2',
        '#f093fb',
        '#4facfe',
        '#00f2fe',
        '#43e97b',
        '#fa709a',
        '#fee140'
    ];
    
    dataManager.deviceChart = new Chart(deviceCtx, {
        type: 'doughnut',
        data: {
            labels: devices,
            datasets: [{
                data: totalActions,
                backgroundColor: colors.slice(0, devices.length),
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        font: {
                            size: 12
                        }
                    }
                }
            }
        }
    });
}

// ฟังก์ชันสำหรับแสดง/ซ่อนหน้า
function showPage(pageId) {
    // ซ่อนหน้าทั้งหมด
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    // แสดงหน้าที่เลือก
    document.getElementById(pageId).classList.add('active');
    
    // อัปเดตกราฟเมื่อแสดงหน้ากราฟ
    if (pageId === 'graph') {
        setTimeout(() => updateGraphs(), 100);
    }
}

// ฟังก์ชันสำหรับล้างประวัติ
function clearHistory() {
    if (confirm('คุณแน่ใจหรือว่าต้องการล้างประวัติทั้งหมด?')) {
        dataManager.clearHistory();
        updateHistory();
        updateStatistics();
        updateGraphs();
        showNotification('✅ ล้างประวัติเรียบร้อยแล้ว');
    }
}

// ฟังก์ชันสำหรับดาวน์โหลดประวัติ
function exportHistory() {
    const history = dataManager.getHistory();
    const stats = dataManager.getStats();
    
    const exportData = {
        exportDate: new Date().toLocaleString('th-TH'),
        history: history,
        statistics: stats
    };
    
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `DEMOTE_${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showNotification('✅ ดาวน์โหลดเรียบร้อยแล้ว');
}

// ฟังก์ชันสำหรับรีเซ็ตสถิติ
function resetStatistics() {
    if (confirm('คุณแน่ใจหรือว่าต้องการรีเซ็ตสถิติทั้งหมด?')) {
        dataManager.stats = {};
        dataManager.saveData();
        updateStatistics();
        updateGraphs();
        showNotification('✅ รีเซ็ตสถิติเรียบร้อยแล้ว');
    }
}

// เริ่มต้นเมื่อโหลดหน้า
document.addEventListener('DOMContentLoaded', function() {
    updateHistory();
    updateStatistics();
    updateGraphs();
    
    // ตั้งเวลาสำหรับล้างข้อมูลเก่าทุกชั่วโมง
    setInterval(() => {
        dataManager.cleanOldData();
        updateHistory();
        updateStatistics();
    }, 60 * 60 * 1000);
});

// เพิ่ม CSS animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
