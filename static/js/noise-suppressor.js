// AudioWorklet для шумоподавления
class NoiseSuppressor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.noiseLevel = 0.01;
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        
        if (input.length > 0) {
            const inputChannel = input[0];
            const outputChannel = output[0];
            
            // Простой алгоритм шумоподавления
            for (let i = 0; i < inputChannel.length; i++) {
                let sample = inputChannel[i];
                
                // Фильтрация низкоуровневого шума
                if (Math.abs(sample) < this.noiseLevel) {
                    sample = sample * 0.1; // Уменьшаем шум
                }
                
                outputChannel[i] = sample;
            }
        }
        
        return true;
    }
}

registerProcessor('noise-suppressor', NoiseSuppressor);

