export const en: Record<string, string> = {
  'app.title': 'Down the stack',
  'app.tagline': 'One real web request, from the keystroke to the radio wave',

  // --- chapters -------------------------------------------------------------
  'chapter.press-enter.title': 'You press Enter',
  'chapter.press-enter.subtitle': 'and the machine realises it knows almost nothing',
  'chapter.press-enter.body':
    'You typed a name. The network has never heard of names. Before a single byte can be sent anywhere, the browser has to turn example.com into an address, find a route to it, agree on a shared secret with a machine it has never met, and only then ask its question. Everything that follows is that sentence, taken seriously.',

  'chapter.dns-build.title': 'Asking for directions',
  'chapter.dns-build.subtitle': 'twenty-nine bytes of question, wrapped four times over',
  'chapter.dns-build.body':
    'The question itself is small: which address belongs to example.com. Watch what happens to it on the way down. Each layer wraps the one above in a header only it understands, and each wrapper is useless to the layers on either side. By the time the question reaches the antenna it has more than doubled in size, and not one of those added bytes is the question.',

  'chapter.dns-send.title': 'The answer comes back',
  'chapter.dns-send.subtitle': 'a name becomes a number',
  'chapter.dns-send.body':
    'The resolver answers with two addresses, and does something quietly clever: rather than spelling out example.com a second time, it points back to where the name already appears in the message. Two bytes instead of thirteen. The whole reply fits in a single packet.',

  'chapter.tcp-handshake.title': 'Three packets to say hello',
  'chapter.tcp-handshake.subtitle': 'before any data at all',
  'chapter.tcp-handshake.body':
    'Nothing useful is sent yet. These three packets exist so both ends agree on where their byte numbering starts, how much they may send before waiting for a receipt, and which optional behaviours they both support. One full round trip spent entirely on agreement.',

  'chapter.tls-handshake.title': 'Agreeing on a secret',
  'chapter.tls-handshake.subtitle': 'in public, watched by anyone',
  'chapter.tls-handshake.body':
    'The client sends a public key before the server has said anything at all, which is why TLS 1.3 needs only one round trip. Two things still travel in the clear, and it is worth noticing which: the name of the site you are visiting, and the size of everything that follows. Encryption hides what you said. It does not hide that you said it, or to whom.',

  'chapter.encapsulation.title': 'The whole descent',
  'chapter.encapsulation.subtitle': 'this is what encapsulation actually means',
  'chapter.encapsulation.body':
    'Here is the request for the page, followed all the way down. Watch the coloured block at the top: it never changes. Everything else is packaging, added by a layer that will be discarded by the next device, or that only the far end will ever open. The payload keeps its identity. The wrappers do not.',

  'chapter.physical.title': 'Into the air',
  'chapter.physical.subtitle': 'where bytes stop being bytes',
  'chapter.physical.body':
    'The frame is scrambled so it stops looking repetitive, doubled in size so errors can be corrected without asking for a retransmission, shuffled so a dead frequency damages scattered bits rather than a run of them, and finally turned into points on a plane. Fifty-two of those points are transmitted at once, on fifty-two slightly different frequencies, and the sum of them is the wave that leaves the antenna.',

  'chapter.hops.title': 'Rebuilt at every hop',
  'chapter.hops.subtitle': 'the part almost every diagram gets wrong',
  'chapter.hops.body':
    'At each device the outermost wrapper is not forwarded. It is thrown away and a completely new one is written, for a completely different medium. The packet inside crosses radio, copper and glass without ever being rewritten, except for one field: a counter that drops by one each time, so that a packet caught in a loop eventually dies instead of circling forever.',

  'chapter.response.title': 'And back again',
  'chapter.response.subtitle': 'the page arrives',
  'chapter.response.body':
    'The answer climbs the same stack in reverse. Each layer removes its own header, hands what is left upward, and stops caring. At the top, a wall of ciphertext becomes readable text, and the browser finally has the thing you asked for.',

  // --- interface ------------------------------------------------------------
  'ui.play': 'Play',
  'ui.pause': 'Pause',
  'ui.restart': 'Restart',
  'ui.speed': 'Speed',
  'ui.realTime': 'Elapsed on the wire',
  'ui.timeScale': 'Time scale',
  'ui.layer': 'Layer',
  'ui.chapter': 'Chapter',
  'ui.inspector': 'Inspector',
  'ui.inspector.empty': 'Click any byte in the scene, or any field in the list, to see what it is and why it exists.',
  'ui.bytes': 'bytes',
  'ui.overhead': 'wrapper',
  'ui.payload': 'payload',
  'ui.reconstructed': 'Reconstructed, not captured',
  'ui.reconstructed.why':
    'When a laptop is on Wi-Fi, capture tools are handed an Ethernet-shaped frame: the driver has already stripped the radio framing. Seeing the real 802.11 frame needs monitor mode and a second machine. This frame is built from the same payload the capture proves was sent, and it is shown unprotected: on a WPA network the payload carries a CCMP header and an integrity check, and is encrypted between here and the access point.',
  'ui.groundTruth': 'Real capture',
  'ui.groundTruth.detail': 'Every byte on this screen comes from a real session recorded on a real network.',
  'ui.decrypted': 'Decrypted live',
  'ui.language': 'Language',
  'ui.of': 'of',
  'ui.hexDump': 'Bytes',
  'ui.fields': 'Fields',
  'ui.noWireTime': 'nothing is on the wire yet',
  'scale.faster': '{n} times faster than reality',
  'scale.slower': '{n} times slower than reality',
  'scale.thousand': '{n} thousand times slower',
  'scale.million': '{n} million times slower',

  // --- labels drawn inside the 3D scene -------------------------------------
  'scene.bits': 'coded bits',
  'scene.constellation': '64-QAM constellation',
  'scene.subcarriers': '52 subcarriers, the centre one left empty',
  'scene.waveform': 'the wave that leaves the antenna',
  'scene.bytesAdded': '{n} bytes added by this layer',
  'scene.payloadBytes': '{n} bytes of payload',

  // --- protocol field explanations -----------------------------------------
  'field.ethernet.dst': 'The hardware address of the next device on this cable or this radio link, and nothing further. It is not the destination of the packet.',
  'field.ethernet.src': 'The hardware address of the interface sending. The first byte carries two flags, one of which says whether the address was burned in at the factory or chosen by software.',
  'field.ethernet.ethertype': 'Two bytes that say what is inside, so the receiver knows which parser to hand it to. Without this the payload would be an undifferentiated pile of bytes.',
  'field.ethernet.mac.local': 'Set when the address was assigned by software rather than by the manufacturer. Phones and laptops now randomise their address on purpose, so that networks cannot recognise them between visits.',

  'field.ipv4.version': 'Four, in the first four bits, so a receiver can tell an IPv4 packet from an IPv6 one before parsing anything else.',
  'field.ipv4.ihl': 'The header length in 32-bit words. Five words is the usual twenty bytes; the field is four bits wide, which caps the IPv4 header at sixty bytes forever.',
  'field.ipv4.total_length': 'Header and payload together. This is what makes the packet self-delimiting, and it is why the Ethernet padding at the end of short frames is not mistaken for data.',
  'field.ipv4.id': 'An identifier shared by all fragments of one original packet, so the far end can tell them apart from a different packet arriving at the same time.',
  'field.ipv4.flags': 'Three bits. One of them, do not fragment, is how a sender discovers the largest packet a path will carry: send it too big, and a router will say so rather than splitting it.',
  'field.ipv4.ttl': 'Named for time, counted in hops. Every router subtracts one, and the packet is destroyed at zero. It is the only thing preventing a routing mistake from filling the network with packets that circle forever.',
  'field.ipv4.protocol': 'Says which transport protocol is inside: six for TCP, seventeen for UDP. The same role the EtherType plays one layer below.',
  'field.ipv4.checksum': 'Covers the header only, never the payload. Every router rewrites the hop counter, and re-checksumming the whole packet at every hop would be unaffordable.',
  'field.ipv4.src': 'Where the packet claims to come from. Nothing in IP verifies this, which is the root of a whole family of attacks.',
  'field.ipv4.dst': 'The one field every router on the path actually reads.',

  'field.udp.length': 'Header and payload. UDP adds eight bytes and no promises: no ordering, no retransmission, no connection. That is why DNS uses it.',
  'field.udp.checksum': 'Optional in IPv4, and computed over a pseudo-header that includes the IP addresses from the layer below. A deliberate break in the layering, so that a packet delivered to the wrong host fails its transport check.',

  'field.tcp.src_port': 'Chosen at random by the client. It is what lets one machine hold hundreds of simultaneous conversations over one address.',
  'field.tcp.dst_port': 'Identifies the service rather than the machine. 443 means whoever is listening there speaks HTTPS.',
  'field.tcp.seq': 'The byte number of the first byte in this segment. It starts at a random value rather than zero, so that an attacker who cannot see the connection cannot guess where to inject data.',
  'field.tcp.ack': 'The next byte number this end expects. Acknowledging is cumulative: this number says everything before it arrived.',
  'field.tcp.flags': 'Eight bits that carry the whole connection state machine. SYN opens, FIN closes politely, RST closes rudely, ACK confirms.',
  'field.tcp.window': 'How many more bytes this end is willing to accept right now. The receiver, not the sender, sets the pace. This single number is the whole of flow control.',
  'field.tcp.checksum': 'Like UDP, computed over a pseudo-header borrowed from IP.',
  'field.tcp.opt.mss': 'The largest payload this end wants per segment, chosen so the finished packet fits the link without being fragmented.',
  'field.tcp.opt.window_scale': 'The window field is sixteen bits, which caps it at 64 kilobytes: far too small for a modern link. This option multiplies it by a power of two, and it can only be negotiated in the opening packets.',
  'field.tcp.opt.timestamps': 'Lets each end measure the round trip time accurately, and tells apart an old duplicate segment from a legitimate new one.',
  'field.tcp.opt.nop': 'A single padding byte. Options must land on four-byte boundaries, and the sender pads rather than reorder them.',

  'field.dns.id': 'Sixteen bits that pair a reply to its question. Since DNS runs over a connectionless protocol, this number and the port are all that link them.',
  'field.dns.flags.rd': 'Recursion desired: the client is asking the resolver to do the whole chase, from the root down, rather than returning a referral.',
  'field.dns.qname': 'The name, written as a series of length-prefixed labels. There are no dots on the wire: 7example3com0.',
  'field.dns.answer': 'An address, and how long it may be cached. The cache lifetime is why a site can be moved without every visitor noticing, and why a mistake takes hours to disappear.',

  'field.tls.record.type': 'Once the handshake is done every record claims to be application data, whatever it really holds. The true type is the last byte of the plaintext, so an observer cannot tell a key update from a page request.',
  'field.tls.record.version': 'Permanently frozen at the value meaning TLS 1.2. Too many middleboxes on the Internet drop anything that announces a newer version, so TLS 1.3 lies here and negotiates the real version inside an extension.',
  'field.tls.ext.server_name': 'The name of the site you are visiting, sent in the clear, before encryption starts. The server needs it to choose which certificate to present. Anyone watching the link can read it.',
  'field.tls.ext.key_share': 'A public key, sent before the server has replied. Guessing correctly which key exchange the server will accept is what lets TLS 1.3 finish in one round trip instead of two.',
  'field.tls.hello.random': 'Thirty-two fresh random bytes from each side, mixed into every derived key so that two identical sessions never produce the same keys.',

  'field.wifi.fc': 'Two bytes that say what kind of frame this is and which direction it travels through the access point.',
  'field.wifi.duration': 'How long the sender is claiming the air. Every other station hears it and stays quiet. Wi-Fi cannot detect collisions while transmitting, so it books the medium in advance instead.',
  'field.wifi.addr1': 'Wi-Fi carries three addresses where Ethernet carries two, because a frame passing through an access point has a receiver and a final destination that are not the same device.',
  'field.wifi.snap.ethertype': 'Eight extra bytes of LLC and SNAP exist to carry the two bytes that say IPv4 is inside, because 802.11 has no EtherType field of its own.',

  'field.http.request_line': 'The method, the path, and the version. Three words, and the entire point of everything below.',
  'field.http.blank_line': 'Two bytes, carriage return and line feed, twice. That is the whole framing mechanism: it marks where the headers end and the body begins.',



  // --- the path across the network -------------------------------------------
  'hop.laptop': 'This laptop',
  'hop.access-point': 'Access point',
  'hop.home-router': 'Home router',
  'hop.isp-edge': 'ISP edge',
  'hop.regional-core': 'Regional core',
  'hop.peering': 'Peering point',
  'hop.backbone': 'Backbone',
  'hop.datacentre-edge': 'Datacentre edge',
  'hop.load-balancer': 'Load balancer',
  'hop.server': 'The server',
  'hop.note.laptop': 'Where the request is built, layer by layer.',
  'hop.note.first': 'Strips the 802.11 frame and writes an Ethernet one. The IP packet inside is untouched.',
  'hop.note.router': 'Reads only the destination address, decrements the hop counter, rewrites the link header, forwards.',
  'hop.note.server': 'Unwraps every layer in reverse and finally reads the request.',
  'medium.wifi': 'Wi-Fi',
  'medium.copper': 'copper',
  'medium.fibre': 'fibre',
  'medium.backbone': 'backbone',
  'frame.wifi': '802.11 frame',
  'frame.copper': 'Ethernet frame',
  'frame.fibre': 'fibre framing',
  'frame.backbone': 'backbone framing',

  // --- what each layer just added -------------------------------------------
  'layer.note.payload': 'What you actually wanted to send. Everything below exists to carry these bytes.',
  'layer.note.udp': 'Adds almost nothing: two ports, a length, a checksum. That is the whole of UDP, and it is why DNS chose it.',
  'layer.note.tcp': 'Adds ordering and delivery guarantees, and a port number so the right program receives it.',
  'layer.note.tcp.request': 'Numbers the bytes so the far end can put them back in order, and asks for a receipt.',
  'layer.note.ipv4': 'Adds the addresses that make the packet routable across the whole Internet. This header survives every hop.',
  'layer.note.ipv4.request': 'The only header that travels the whole way unchanged, apart from one field: the hop counter.',
  'layer.note.ethernet': 'Adds hardware addresses valid for one single link. Thrown away and rebuilt at the very next device.',
  'layer.note.ethernet.request': 'Valid for exactly one link. The next device discards it entirely and writes its own.',
  'layer.note.wifi': 'The real first hop. It costs {n} bytes of wrapper against Ethernet\'s {eth}, because it needs three addresses, an air-time reservation, and eight bytes of SNAP just to say that IPv4 is inside.',
  'layer.note.wifi.request': 'What actually leaves the antenna, before any of it becomes a radio wave.',
  'layer.note.http': 'A few lines of text ending in a blank line. This is the thing everything else exists to deliver.',
  'layer.note.tls': 'Encrypts the request and appends a 16 byte authentication tag. From here down nothing can read the text above, and every router below carries {n} bytes it cannot interpret.',

  // --- physical layer -------------------------------------------------------
  'phy.scramble': 'Scrambling',
  'phy.scramble.body': 'A long run of identical bits would put all the energy on one frequency and leave the receiver nothing to lock its clock onto. A seven-bit shift register makes the data look random, and the receiver runs the same register to undo it.',
  'phy.encode': 'Error correction',
  'phy.encode.body': 'Every bit becomes two, each a parity over the last seven. A quarter of that is then thrown away again to reach the target rate. What survives lets the receiver repair flipped bits without asking for anything to be sent twice, which matters because at this layer there is nobody to ask.',
  'phy.interleave': 'Interleaving',
  'phy.interleave.body': 'The bits are shuffled inside each symbol. A notch in the radio channel wipes out one frequency, and the shuffle turns what would have been a run of consecutive errors into scattered single ones. Scattered errors are exactly what the code above can repair.',
  'phy.map': 'Modulation',
  'phy.map.body': 'Six bits at a time become one point on a plane, out of sixty-four possible positions. Neighbouring points differ by exactly one bit, so the most likely mistake, mistaking a point for its neighbour, costs one bit rather than six.',
  'phy.subcarriers': 'Subcarriers',
  'phy.subcarriers.body': 'Fifty-two frequencies are transmitted at once: forty-eight carrying data, four carrying known reference tones so the receiver can measure how the channel distorted things. The centre frequency is deliberately left empty.',
  'phy.ifft': 'The waveform',
  'phy.ifft.body': 'An inverse Fourier transform sums all fifty-two frequencies into a single wave, four microseconds long. The last fifth of it is copied to the front as a sacrificial landing zone for echoes bouncing off walls, which is what makes this work indoors at all.',
};
