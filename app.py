import os
import re
import time
import pickle
import numpy as np
import librosa
from flask import Flask, request, render_template, jsonify
from tensorflow.keras.models import load_model

app = Flask(__name__)

# One combined model: 12 speakers + 10 nature/animal sounds
model = load_model('combined_model_v5.keras')
with open('combined_labels_v5.pkl', 'rb') as f:
    class_names = list(pickle.load(f))

UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

SAMPLES_DIR = os.path.join(os.path.dirname(__file__), 'new_samples')

CONFIDENCE_THRESHOLD = 0.70


def extract_features(file_path):
    audio, sample_rate = librosa.load(file_path, res_type='kaiser_fast')
    # Same volume normalization as training, so any mic level works
    audio = audio / (np.max(np.abs(audio)) + 1e-9) * 0.8
    mfccs = librosa.feature.mfcc(y=audio, sr=sample_rate, n_mfcc=40)
    features = np.concatenate([mfccs.mean(axis=1), mfccs.std(axis=1)])  # 80 values
    return features.reshape(1, -1)


def predict_top_k(file_path, k=8):
    features = extract_features(file_path)
    probabilities = model.predict(features, verbose=0)[0]

    top_indices = np.argsort(probabilities)[::-1][:k]
    top_predictions = [
        {'label': class_names[i], 'confidence': float(probabilities[i])}
        for i in top_indices
    ]
    return top_predictions


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/predict', methods=['POST'])
def predict():
    file = request.files.get('audio_file')

    if not file or file.filename == '':
        return jsonify({'error': 'No audio received.'}), 400

    filename = file.filename if file.filename else 'clip.wav'
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    file.save(file_path)

    try:
        top_predictions = predict_top_k(file_path, k=8)
    except Exception as e:
        return jsonify({'error': f'Could not process this audio: {str(e)}'}), 500
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

    best = top_predictions[0]
    is_confident = best['confidence'] >= CONFIDENCE_THRESHOLD

    return jsonify({
        'prediction': best['label'],
        'confidence': best['confidence'],
        'is_confident': is_confident,
        'threshold': CONFIDENCE_THRESHOLD,
        'top_predictions': top_predictions
    })


@app.route('/save_sample', methods=['POST'])
def save_sample():
    name = request.form.get('speaker_name', '').strip()
    file = request.files.get('audio_file')
    if not name or not file:
        return jsonify({'error': 'Missing name or audio.'}), 400
    safe_name = re.sub(r'[^a-zA-Z0-9_]', '', name)
    if not safe_name:
        return jsonify({'error': 'Invalid name.'}), 400
    folder = os.path.join(SAMPLES_DIR, safe_name)
    os.makedirs(folder, exist_ok=True)
    filename = f"{safe_name}_{int(time.time() * 1000)}.wav"
    file.save(os.path.join(folder, filename))
    return jsonify({'saved': filename})


if __name__ == '__main__':
    app.run(debug=True, use_reloader=False)
