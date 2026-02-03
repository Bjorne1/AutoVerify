importScripts('model.js');

const STORAGE_KEY = 'autoVerifyRules';

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    if (request.action === "ping") {
        sendResponse({"action": "pong"});
        return true;
    } else if (request.data && request.action === "ocr") {
      base64ToImageBitmap(request.data)
        .then(imageBitmap => {
          return location['getImageData'](imageBitmap);
        })
        .then(imageData => {
          return location['preprocessImage'](imageData);
        })
        .then(preprocessedImage => {
          if (!preprocessedImage) {
            throw new Error("Preprocessing failed");
          }
          return location['runModel'](preprocessedImage);
        })
        .then(result => {
          sendResponse({"action": "response_code", "data": result});
        })
        .catch(error => {
          console.error("Error in OCR processing pipeline:", error);
          sendResponse({"action": "error", "data": "OCR Failed: " + error.message});
        });
    }else if(request.action === "getRules"){
		chrome.storage.sync.get([STORAGE_KEY], function(result) {
			if (chrome.runtime.lastError) {
			    console.error(`Error getting rules:`, chrome.runtime.lastError);
			    sendResponse({"action": "getRules", "data": []});
			} else {
			    sendResponse({"action": "getRules", "data": result[STORAGE_KEY] || []});
			}
		});
	}else{
		sendResponse({"action": "pong", "data": ""});
	}
	return true;
  }
);

function base64ToImageBitmap(base64Data) {
  return new Promise((resolve, reject) => {
    fetch(base64Data)
      .then(response => {
          if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.blob();
      })
      .then(blob => {
          if (!blob.type.startsWith('image/')){
              throw new Error('Fetched data is not an image blob');
          }
          return createImageBitmap(blob);
      })
      .then(imageBitmap => {
        resolve(imageBitmap);
      })
      .catch(error => {
        console.error('Error converting Base64 to ImageBitmap:', error);
        reject(error);
      });
  });
}
