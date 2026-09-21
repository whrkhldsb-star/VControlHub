FROM guacamole/guacd@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f AS builder
USER root
RUN apk add --no-cache build-base cmake python3 cairo-dev krb5-dev libjpeg-turbo-dev libpng-dev openssl1.1-compat-dev zlib-dev
WORKDIR /build
COPY freerdp-2.11.7.tar.gz harden-freerdp-pin.py ./
RUN printf '22dbeeaad065e93f152d70e04ec8eeab08aa32c406a96be64f252526623625a4  freerdp-2.11.7.tar.gz\n' | sha256sum -c - && tar xzf freerdp-2.11.7.tar.gz && python3 harden-freerdp-pin.py FreeRDP-2.11.7/libfreerdp/crypto/tls.c
RUN cmake -S FreeRDP-2.11.7 -B out -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/guacamole -DWITH_SAMPLE=OFF -DWITH_TESTING=OFF \
    -DBUILTIN_CHANNELS=OFF \
    -DCHANNEL_URBDRC=OFF \
    -DWITH_ALSA=OFF \
    -DWITH_CAIRO=ON \
    -DWITH_CHANNELS=ON \
    -DWITH_CLIENT=ON \
    -DWITH_CUPS=OFF \
    -DWITH_DIRECTFB=OFF \
    -DWITH_FFMPEG=OFF \
    -DWITH_FUSE=OFF \
    -DWITH_GSM=OFF \
    -DWITH_GSSAPI=OFF \
    -DWITH_IPP=OFF \
    -DWITH_JPEG=ON \
    -DWITH_KRB5=ON \
    -DWITH_LIBSYSTEMD=OFF \
    -DWITH_MANPAGES=OFF \
    -DWITH_OPENH264=OFF \
    -DWITH_OPENSSL=ON \
    -DWITH_OSS=OFF \
    -DWITH_PCSC=OFF \
    -DWITH_PKCS11=OFF \
    -DWITH_PULSE=OFF \
    -DWITH_SERVER=OFF \
    -DWITH_SERVER_INTERFACE=OFF \
    -DWITH_SHADOW_MAC=OFF \
    -DWITH_SHADOW_X11=OFF \
    -DWITH_SWSCALE=OFF \
    -DWITH_WAYLAND=OFF \
    -DWITH_X11=OFF \
    -DWITH_X264=OFF \
    -DWITH_XCURSOR=ON \
    -DWITH_XEXT=ON \
    -DWITH_XI=OFF \
    -DWITH_XINERAMA=OFF \
    -DWITH_XKBFILE=ON \
    -DWITH_XRENDER=OFF \
    -DWITH_XTEST=OFF \
    -DWITH_XV=OFF \
    -DWITH_ZLIB=ON && cmake --build out -j4 && DESTDIR=/stage cmake --install out
FROM guacamole/guacd@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f
COPY --from=builder /stage/opt/guacamole/lib/ /opt/guacamole/lib/
LABEL org.vcontrolhub.rdp-pin="exclusive-sha256-v1" org.vcontrolhub.freerdp.version="2.11.7"
