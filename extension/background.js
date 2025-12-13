chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_CAPTURE") {
    chrome.tabCapture.capture(
      { video: true, audio: false },
      stream => {
        chrome.storage.local.set({ streamId: stream.id });
      }
    );
  }
});
