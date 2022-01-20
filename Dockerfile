FROM node:16

LABEL project-name ='kafka-registry-provisioner'

RUN npm i -g ts-node

USER 1001

WORKDIR /home/kafka-registry-provisioner

COPY node_modules/ ./node_modules/
COPY src/ ./src/

CMD [ "ts-node", "src/index.ts" ]