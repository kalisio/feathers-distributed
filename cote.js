/* Really simple cote example for testing purpose, based on env var this will create
  - a requester
  - a responder

Run this command to build the container image:

docker build -t kalisio/cote -f dockerfile.cote .

Then launch multiple instances like this to see if everything works fine in your network:

docker run -d --rm --name app1 -e "RESPONDER=service1" -e "DEBUG=portfinder*" kalisio/cote
docker run -d --rm --name app2 -e "REQUESTER=service1" -e "RESPONDER=service2" -e "DEBUG=portfinder*" kalisio/cote
docker run -d --rm --name app3 -e "REQUESTER=service1" -e "REQUESTER=service2" -e "DEBUG=portfinder*" kalisio/cote
docker logs -f app1/app2/app3
docker stop app1/app2/app3

In a swarm:

docker service create --replicas 1 --name app1 -e "RESPONDER=service1" -e "DEBUG=portfinder*" kalisio/cote
docker service create --replicas 1 --name app2 -e "REQUESTER=service1" -e "RESPONDER=service2" -e "DEBUG=portfinder*" kalisio/cote
docker service create --replicas 1 --name app3 -e "REQUESTER=service1" -e "REQUESTER=service2" -e "DEBUG=portfinder*" kalisio/cote
docker service logs -f app1/app2/app3
docker service rm app1/app2/app3

Launch a redis service and add -e "COTE_DISCOVERY_REDIS_URL=redis://redis:6379" when launching app for centralized discovery
docker service create --replicas 1 --name redis redis:5

Create a dedicated network and add --network your_network when deploying app to segregate communication:
docker network create -d overlay --attachable your_network
*/

const portfinder = require ('portfinder')
const cote = require('cote')

// Change default base/highest port for automated port finding
portfinder.basePort = 10000
portfinder.highestPort = 20000

if (process.env.REQUESTER) {
	const requester = new cote.Requester({ name: process.env.REQUESTER })
	setInterval(() => requester.send({ type: 'message', pid: process.pid }, (content) => {
	    console.log(`Message received at ${ new Date().toISOString() } in pid ${process.pid}`)
	    console.log(content)
	}), 5000)
}
if (process.env.RESPONDER) {
	const responder = new cote.Responder({ name: process.env.RESPONDER })
	responder.on('message', (req, cb) => {
		console.log(`Sending message at ${ new Date().toISOString() } in pid ${process.pid}`)
	    cb(`Message sent on ${ new Date().toISOString() } from pid ${process.pid}`)
	})
}
