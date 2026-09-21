#!/usr/bin/env python3
"""Actual guacd->RDP TLS test: compare post-verification RDP data, not handshake alone.
Uses generated local CA certificate and no production credentials.
"""
import socket,ssl,threading,subprocess,hashlib,json,time
from pathlib import Path
ROOT=Path('/tmp/vch-pin-integration'); ROOT.mkdir(exist_ok=True)
if not (ROOT/'cert.pem').exists(): subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(ROOT/'key.pem'),'-out',str(ROOT/'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
der=ssl.PEM_cert_to_DER_cert((ROOT/'cert.pem').read_text()); digest=hashlib.sha256(der).hexdigest()
def instr(*a): return (','.join(str(len(x))+'.'+x for x in a)+';').encode()
def recvinst(s):
    vals=[]
    while True:
        n=b''
        while (c:=s.recv(1))!=b'.':
            if not c: raise EOFError()
            n+=c
        data=b''
        while len(data)<int(n): data+=s.recv(int(n)-len(data))
        vals.append(data.decode()); end=s.recv(1)
        if end==b';': return vals

def run(port,pin,ignore=False):
    result={'guacd_port':port,'pin':pin,'ignore':ignore,'post_tls_bytes':0}
    listener=socket.socket();listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);listener.bind(('127.0.0.1',3398));listener.listen()
    def server():
        try:
            c,_=listener.accept();c.settimeout(7);c.recv(4096)
            c.sendall(bytes.fromhex('030000130ed000001234000200080001000000'))
            ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(ROOT/'cert.pem',ROOT/'key.pem')
            with ctx.wrap_socket(c,server_side=True) as tls:
                try: result['post_tls_bytes']=len(tls.recv(4096))
                except (ssl.SSLError,TimeoutError,ConnectionError) as e: result['tls_result']=type(e).__name__
        except Exception as e:result['server_error']=repr(e)
        finally:listener.close()
    thread=threading.Thread(target=server,daemon=True);thread.start()
    s=socket.create_connection(('127.0.0.1',port));s.settimeout(10);s.sendall(instr('select','rdp'));args=recvinst(s)
    assert args[0]=='args'
    values={'hostname':'127.0.0.1','port':'3398','security':'tls','ignore-cert':str(ignore).lower(),'cert-tofu':'false','cert-fingerprints':pin,'width':'800','height':'600','dpi':'96','disable-audio':'true'}
    s.sendall(instr('size','800','600','96')+instr('audio')+instr('video')+instr('image','image/png')+instr('connect',*[values.get(k,'') for k in args[1:]]))
    thread.join(10)
    try:
        while True:
            response=recvinst(s)
            if response[0] in ('error','disconnect'): break
            if response[0]=='sync': s.sendall(instr(*response))
    except (TimeoutError,EOFError,ConnectionError): pass
    s.sendall(instr('disconnect'));s.close();time.sleep(1);return result
if __name__=='__main__':
    import sys
    if '--setup' in sys.argv: print(str(ROOT/'cert.pem'));raise SystemExit
    good='sha256:'+':'.join(digest[i:i+2] for i in range(0,64,2));bad='sha256:'+':'.join(['00']*32)
    results=[run(4824,bad),run(4823,good),run(4823,bad),run(4823,bad,True)]
    print(json.dumps(results,indent=2));(ROOT/'results.json').write_text(json.dumps(results,indent=2))
    assert results[0]['post_tls_bytes']>0,'Stock CA-trusted wrong-pin baseline must proceed'
    assert results[1]['post_tls_bytes']>0,'Correct pin must proceed'
    assert results[2]['post_tls_bytes']==results[3]['post_tls_bytes']==0,'Wrong pins must fail before RDP data'
