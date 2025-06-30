from google.cloud import speech
from google.cloud import translate
import tornado.websocket
import tornado.ioloop
import tornado.web
import threading
import queue
import json
import os

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "./credential.json"

class STTClient:
    def __init__(self, websocket_handler=None):
        self.buff = queue.Queue()
        self.closed = False
        self.transcript = None
        self.websocket_handler = websocket_handler  # WebSocketHandler を保持

    def ready(self):
        streaming_config = speech.StreamingRecognitionConfig(
            config=speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=16000,
                language_code="en-US",
                enable_automatic_punctuation=True
            ),
            interim_results=False
        )
        client = speech.SpeechClient()
        translate_client = translate.TranslationServiceClient()
        stream = self.generator()
        requests = (speech.StreamingRecognizeRequest(audio_content=content) for content in stream)
        while True:
            try:
                responses = client.streaming_recognize(streaming_config, requests)
                for response in responses:
                    if len(response.results) > 0:
                        self.transcript = response.results[0].alternatives[0].transcript
                        if response.results[0].is_final:
                            # WebSocket メッセージを送信
                            if self.websocket_handler and 0 < len(response.results[0].alternatives[0].transcript):
                                translate_resp = translate_client.translate_text(
                                    contents=[response.results[0].alternatives[0].transcript],
                                    target_language_code="ja",
                                    parent="XXX",
                                )
                                self.websocket_handler.write_message(json.dumps({"original": response.results[0].alternatives[0].transcript, "translated": translate_resp.translations[0].translated_text}, ensure_ascii=False))
                    if self.closed:
                        break
            except Exception as e:
                print(f"Error: {e}")

    def close(self):
        self.closed = True

    def write(self, buffer):
        self.buff.put(bytes(buffer), block=False)

    def generator(self):
        while not self.closed:
            chunk = self.buff.get()
            if chunk is None:
                return
            data = [chunk]
            while True:
                try:
                    chunk = self.buff.get(block=False)
                    if chunk is None:
                        return
                    data.append(chunk)
                except queue.Empty:
                    break
            yield b"".join(data)

class WebSocketHandler(tornado.websocket.WebSocketHandler):
    # CORS関係(許可されたoriginであればTrueを返す)
    def check_origin(self, origin):
        return True

    # クライアント接続時
    def open(self):
        self.stt = STTClient(websocket_handler=self)  # WebSocketHandler を渡す
        self.stt_thread = threading.Thread(target=self.stt.ready)
        self.stt_thread.setDaemon(True)
        self.stt_thread.start()
        print("Connected.")

    # メッセージ受信時
    def on_message(self, message):
        if message is None:
            self.stt.write(None)
            self.stt.close()
            return
        if type(message) == str:
            print(message)
        elif type(message) == None:
            return
        else:
            self.stt.write(message)

    # クライアント切断時
    def on_close(self):
        self.stt.close()
        print("Disconnected.")

if __name__ == "__main__":
    app = tornado.web.Application([
        (r"/", WebSocketHandler)
    ])
    app.listen(80)
    tornado.ioloop.IOLoop.instance().start()