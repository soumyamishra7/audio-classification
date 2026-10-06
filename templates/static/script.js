lucide.createIcons();

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        document.querySelectorAll('.tool-content').forEach(p => p.classList.remove('active'));
        document.getElementById('page-' + item.dataset.page).classList.add('active');
    });
});

const themeToggle = document.getElementById('themeToggle');
const themeLabel = document.getElementById('themeLabel');
let isDark = true;
themeToggle.addEventListener('click', () => {
    isDark = !isDark;
    document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    themeLabel.textContent = isDark ? 'Dark mode' : 'Light mode';
    document.getElementById('themeIcon').setAttribute('data-lucide', isDark ? 'moon' : 'sun');
    lucide.createIcons();
});

function showToast(message, type = 'error') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const icon = type === 'error' ? 'alert-circle' : 'check-circle-2';
    toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    lucide.createIcons();
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.25s ease forwards';
        setTimeout(() => toast.remove(), 250);
    }, 4000);
}

async function convertToWav(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const sampleRate = audioBuffer.sampleRate;
    const samples = audioBuffer.getChannelData(0);
    return new Blob([encodeWav(samples, sampleRate, 1)], { type: 'audio/wav' });
}

function encodeWav(samples, sampleRate, numChannels) {
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);
    function writeString(offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * bytesPerSample, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
}

function buildWaveform(container, count = 28) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const bar = document.createElement('div');
        bar.className = 'bar';
        container.appendChild(bar);
    }
}

function setupTool({ root, predictUrl, hasThreshold, history }) {
    const dropzone = root.querySelector('[data-dropzone]');
    const fileInput = root.querySelector('[data-file-input]');
    const fileChip = root.querySelector('[data-file-chip]');
    const fileChipName = root.querySelector('[data-file-chip-name]');
    const fileChipRemove = root.querySelector('[data-file-chip-remove]');
    const submitBtn = root.querySelector('[data-submit-btn]');
    const btnText = root.querySelector('[data-btn-text]');
    const spinner = root.querySelector('[data-spinner]');
    const resultBox = root.querySelector('[data-result]');
    const predictedClass = root.querySelector('[data-predicted-class]');
    const ringFill = root.querySelector('[data-ring-fill]');
    const ringText = root.querySelector('[data-ring-text]');
    const predList = root.querySelector('[data-pred-list]');
    const thresholdMsg = root.querySelector('[data-threshold-msg]');
    const historyList = root.querySelector('[data-history-list]');

    const micBtn = root.querySelector('[data-mic-btn]');
    const recordStatus = root.querySelector('[data-record-status]');
    const recordTimer = root.querySelector('[data-record-timer]');
    const recordPreview = root.querySelector('[data-record-preview]');
    const downloadLink = root.querySelector('[data-download-link]');
    const waveform = root.querySelector('[data-waveform]');
    buildWaveform(waveform);

    let selectedBlob = null;
    let selectedName = null;

    root.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            root.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            root.querySelector(`[data-panel="${btn.dataset.tab}"]`).classList.add('active');
            resetSelection();
            hideResult();
        });
    });

    function resetSelection() {
        selectedBlob = null; selectedName = null;
        submitBtn.disabled = true;
        fileChip.style.display = 'none';
        fileInput.value = '';
        recordPreview.style.display = 'none';
        downloadLink.style.display = 'none';
        recordStatus.textContent = 'Tap to start recording';
        recordTimer.style.display = 'none';
        micBtn.classList.remove('recording');
    }

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; handleFile(fileInput.files[0]); }
    });
    fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });
    fileChipRemove.addEventListener('click', e => { e.stopPropagation(); resetSelection(); hideResult(); });

    function handleFile(file) {
        selectedBlob = file; selectedName = file.name;
        fileChipName.textContent = file.name;
        fileChip.style.display = 'flex';
        submitBtn.disabled = false;
        hideResult();
    }

    let mediaRecorder = null, audioChunks = [], recordInterval = null, recordSeconds = 0;
    let analyser = null, dataArray = null, animFrame = null;

    micBtn.addEventListener('click', async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(stream);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            source.connect(analyser);
            waveform.classList.add('active');
            animateWaveform();

            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                waveform.classList.remove('active');
                cancelAnimationFrame(animFrame);
                buildWaveform(waveform);
                recordStatus.textContent = 'Processing...';
                const webmBlob = new Blob(audioChunks, { type: 'audio/webm' });
                try {
                    const wavBlob = await convertToWav(webmBlob);
                    selectedBlob = wavBlob; selectedName = 'recording.wav';
                    recordPreview.src = URL.createObjectURL(wavBlob);
                    recordPreview.style.display = 'block';
                    submitBtn.disabled = false;
                    recordStatus.textContent = 'Recording captured — ready to go';
                    downloadLink.href = URL.createObjectURL(wavBlob);
                    downloadLink.download = 'voice_sample_' + Date.now() + '.wav';
                    downloadLink.style.display = 'inline-flex';
                } catch (err) {
                    recordStatus.textContent = 'Could not process recording. Try again.';
                    showToast('Could not process the recording.');
                }
                micBtn.classList.remove('recording');
                recordTimer.style.display = 'none';
                clearInterval(recordInterval);
                stream.getTracks().forEach(t => t.stop());
            };

            mediaRecorder.start();
            micBtn.classList.add('recording');
            recordStatus.textContent = 'Recording... tap to stop';
            recordTimer.style.display = 'block';
            recordSeconds = 0; recordTimer.textContent = '00:00';
            recordInterval = setInterval(() => {
                recordSeconds++;
                const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
                const s = String(recordSeconds % 60).padStart(2, '0');
                recordTimer.textContent = `${m}:${s}`;
            }, 1000);
            hideResult();
        } catch (err) {
            showToast('Microphone access denied or unavailable.');
        }
    });

    function animateWaveform() {
        analyser.getByteFrequencyData(dataArray);
        const bars = waveform.querySelectorAll('.bar');
        bars.forEach((bar, i) => {
            const val = dataArray[i % dataArray.length] || 0;
            bar.style.height = Math.max(6, (val / 255) * 48) + 'px';
        });
        animFrame = requestAnimationFrame(animateWaveform);
    }

    submitBtn.addEventListener('click', async () => {
        if (!selectedBlob) return;
        hideResult();
        submitBtn.disabled = true;
        btnText.style.display = 'none';
        spinner.style.display = 'block';

        const formData = new FormData();
        formData.append('audio_file', selectedBlob, selectedName);

        try {
            const res = await fetch(predictUrl, { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || 'Something went wrong.');
            } else {
                showResult(data);
                addHistory(data.prediction, data.confidence);
            }
        } catch (err) {
            showToast('Could not reach the server.');
        } finally {
            submitBtn.disabled = false;
            btnText.style.display = 'inline';
            spinner.style.display = 'none';
        }
    });

    function showResult(data) {
        const pct = Math.round(data.confidence * 100);
        predictedClass.textContent = data.prediction.replaceAll('_', ' ');
        ringText.textContent = pct + '%';

        const circumference = 151;
        const offset = circumference - (circumference * pct / 100);
        if (hasThreshold) {
            ringFill.style.stroke = data.is_confident ? 'var(--accent-2)' : '#f0b429';
        }
        setTimeout(() => { ringFill.style.strokeDashoffset = offset; }, 50);

        if (hasThreshold && thresholdMsg) {
            thresholdMsg.className = 'threshold-msg ' + (data.is_confident ? 'confident' : 'uncertain');
            thresholdMsg.textContent = data.is_confident
                ? `Detected "${data.prediction.replaceAll('_',' ')}" with ${(data.confidence*100).toFixed(2)}% confidence (threshold ${data.threshold*100}%).`
                : `Low confidence (${(data.confidence*100).toFixed(2)}%) — this sound may not match a known category well.`;
        }

        predList.innerHTML = '';
        data.top_predictions.forEach((p, i) => {
            const row = document.createElement('div');
            row.className = 'pred-row' + (i === 0 ? ' top' : '');
            const pctVal = (p.confidence * 100).toFixed(2);
            row.innerHTML = `
                <div class="pred-name">${p.label.replaceAll('_',' ')}</div>
                <div class="pred-bar-bg"><div class="pred-bar-fill" style="width:0%"></div></div>
                <div class="pred-pct">${pctVal}%</div>`;
            predList.appendChild(row);
            setTimeout(() => { row.querySelector('.pred-bar-fill').style.width = pctVal + '%'; }, 80 + i * 60);
        });

        resultBox.style.display = 'block';
    }

    function hideResult() {
        resultBox.style.display = 'none';
        ringFill.style.strokeDashoffset = 151;
    }

    function addHistory(label, confidence) {
        history.unshift({ label, confidence });
        if (history.length > 5) history.pop();
        renderHistory();
    }

    function renderHistory() {
        if (!history.length) {
            historyList.innerHTML = '<div class="history-empty">Nothing yet this session.</div>';
            return;
        }
        historyList.innerHTML = history.map(h => `
            <div class="history-item">
                <span class="h-name">${h.label.replaceAll('_',' ')}</span>
                <span class="h-pct">${(h.confidence*100).toFixed(1)}%</span>
            </div>
        `).join('');
    }
}

setupTool({
    root: document.getElementById('page-sound'),
    predictUrl: '/predict',
    hasThreshold: true,
    history: []
});

setupTool({
    root: document.getElementById('page-speaker'),
    predictUrl: '/predict',
    hasThreshold: true,
    history: []
});


const saveBtn = document.getElementById('saveSampleBtn');
const nameInput = document.getElementById('speakerNameInput');
if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
        const speakerRoot = document.getElementById('page-speaker');
        const preview = speakerRoot.querySelector('[data-record-preview]');
        if (!preview.src) { showToast('Record something first.'); return; }
        const name = nameInput.value.trim();
        if (!name) { showToast('Type a speaker name first.'); return; }
        const blob = await (await fetch(preview.src)).blob();
        const formData = new FormData();
        formData.append('speaker_name', name);
        formData.append('audio_file', blob, 'sample.wav');
        const res = await fetch('/save_sample', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) showToast(`Saved as ${data.saved}`, 'success');
        else showToast(data.error || 'Could not save.');
    });
}