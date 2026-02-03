importScripts("o.min.js");
importScripts("charset.js");
ort.env.wasm.numThreads = 1;

location['getImageData'] = async function(bitmap) {
	const offscreenCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = offscreenCanvas.getContext('2d');
	ctx.drawImage(bitmap, 0, 0);
	const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
	return imageData;
}


location['preprocessImage'] = async function(imageBlob) {
	try {
		const img = await createImageBitmap(imageBlob);
		const offscreenCanvas = new OffscreenCanvas(img.width, img.height);
		const ctx = offscreenCanvas.getContext('2d');
		ctx.drawImage(img, 0, 0, img.width, img.height);
		const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
		const targetHeight = 64;
		const targetWidth = Math.floor((offscreenCanvas.width * targetHeight) / offscreenCanvas.height);
		const resizedCanvas = new OffscreenCanvas(targetWidth, targetHeight);
		const resizedCtx = resizedCanvas.getContext('2d');
		resizedCtx.drawImage(offscreenCanvas, 0, 0, targetWidth, targetHeight);
		const grayscaleImageData = resizedCtx.getImageData(0, 0, targetWidth, targetHeight);
		for (let i = 0; i < grayscaleImageData.data.length; i += 4) {
			const gray = 0.299 * grayscaleImageData.data[i] + 0.587 * grayscaleImageData.data[i + 1] + 0.114 * grayscaleImageData.data[i + 2];
			grayscaleImageData.data[i] = gray;
			grayscaleImageData.data[i + 1] = gray;
			grayscaleImageData.data[i + 2] = gray;
		}
		const input = new Float32Array(targetWidth * targetHeight);
		for (let i = 0; i < grayscaleImageData.data.length; i += 4) {
			input[i / 4] = (grayscaleImageData.data[i] / 255 - 0.5) / 0.5;
		}
		return input;
	} catch (error) {
		//console.error('Failed to preprocess image:', error);
		return null;
	}
}

if(!location['session']){
	ort.InferenceSession.create('model.bin').then(e => {
		location['session'] = e
	})
}
		
location['runModel'] = async function(input) {
	try {
		const inputTensor = new ort.Tensor('float32', input, [1, 1, 64, input.length / 64]);
		const inputs = {
			input1: inputTensor
		};
		const outputMap = await location['session'].run(inputs);
		const outputTensor0 = outputMap['output'];
		const result = [];
		let lastItem = 0;
		for (const item of outputTensor0.data) {
			if (item === lastItem) {
				continue;
			} else {
				lastItem = item;
			}
			if (item !== 0) {
				result.push(charset[item]);
			}
		}
		return result.join('');
	} catch (e) {
		//console.error('Failed to run the model:', e);
		return null;
	}
}