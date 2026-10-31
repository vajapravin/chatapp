FROM iegomez/mosquitto-go-auth:latest

COPY mosquitto.conf /etc/mosquitto/mosquitto.conf

EXPOSE 1883 9001

CMD ["/usr/sbin/mosquitto", "-c", "/etc/mosquitto/mosquitto.conf"]
