FROM  node:7

MAINTAINER Luc Claustres <luc.claustres@kalisio.xyz>

WORKDIR /opt/app
COPY . /opt/app

RUN yarn install

EXPOSE 3031

CMD [ "npm", "start" ]
