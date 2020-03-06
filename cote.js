/* Really simple cote example for testing purpose, based on env var this will create
  - a requester
  - a responder

Run this command to build the container image:

docker build -t kalisio/cote -f .\dockerfile.cote .

Then launch multiple instances like this to see if everything works fine in your network:

docker run -d --rm --name app1 -e "RESPONDER=service1" -e "DEBUG=portfinder*" kalisio/cote
docker run -d --rm --name app2 -e "REQUESTER=service1" -e "RESPONDER=service2" -e "DEBUG=portfinder*" kalisio/cote
docker run -d --rm --name app3 -e "REQUESTER=service1" -e "REQUESTER=service2" -e "DEBUG=portfinder*" kalisio/cote

docker logs -f app1/app2/app3

docker stop app1/app2/app3
*/

const cote = require('cote')

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
