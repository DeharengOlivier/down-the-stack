export const fr: Record<string, string> = {
  'app.title': 'Down the stack',
  'app.tagline': "Une vraie requête web, de la touche Entrée jusqu'à l'onde radio",

  // --- chapitres ------------------------------------------------------------
  'chapter.press-enter.title': 'Tu appuies sur Entrée',
  'chapter.press-enter.subtitle': 'et la machine découvre qu’elle ne sait presque rien',
  'chapter.press-enter.body':
    "Tu as tapé un nom. Le réseau, lui, ne connaît pas les noms. Avant qu'un seul octet ne parte où que ce soit, le navigateur doit transformer example.com en adresse, trouver une route jusqu'à elle, se mettre d'accord sur un secret partagé avec une machine qu'il n'a jamais rencontrée, et seulement ensuite poser sa question. Tout ce qui suit, c'est cette phrase prise au sérieux.",

  'chapter.dns-build.title': 'Demander son chemin',
  'chapter.dns-build.subtitle': 'vingt-neuf octets de question, emballés quatre fois',
  'chapter.dns-build.body':
    "La question est courte : quelle adresse correspond à example.com. Regarde ce qui lui arrive en descendant. Chaque couche emballe celle du dessus dans un en-tête qu'elle seule comprend, et chaque emballage est inutilisable par les couches voisines. Arrivée à l'antenne, la question a plus que doublé de taille, et aucun des octets ajoutés n'est la question.",

  'chapter.dns-send.title': 'La réponse revient',
  'chapter.dns-send.subtitle': 'un nom devient un nombre',
  'chapter.dns-send.body':
    "Le résolveur répond avec deux adresses, et fait au passage quelque chose d'astucieux : plutôt que de réécrire example.com une seconde fois, il pointe vers l'endroit où le nom figure déjà dans le message. Deux octets au lieu de treize. Toute la réponse tient dans un seul paquet.",

  'chapter.tcp-handshake.title': 'Trois paquets pour dire bonjour',
  'chapter.tcp-handshake.subtitle': "avant la moindre donnée",
  'chapter.tcp-handshake.body':
    "Rien d'utile n'est encore transmis. Ces trois paquets existent pour que les deux extrémités s'accordent sur le point de départ de leur numérotation, sur la quantité qu'elles peuvent envoyer avant d'attendre un accusé de réception, et sur les options qu'elles savent toutes les deux gérer. Un aller-retour complet consacré à se mettre d'accord.",

  'chapter.tls-handshake.title': "Se mettre d'accord sur un secret",
  'chapter.tls-handshake.subtitle': 'en public, sous les yeux de tous',
  'chapter.tls-handshake.body':
    "Le client envoie une clé publique avant même que le serveur ait dit quoi que ce soit : c'est pour cela que TLS 1.3 n'a besoin que d'un aller-retour. Deux choses circulent encore en clair, et il vaut la peine de remarquer lesquelles : le nom du site que tu visites, et la taille de tout ce qui suit. Le chiffrement cache ce que tu as dit. Il ne cache ni que tu l'as dit, ni à qui.",

  'chapter.encapsulation.title': 'La descente complète',
  'chapter.encapsulation.subtitle': "voilà ce que veut vraiment dire encapsulation",
  'chapter.encapsulation.body':
    "Voici la requête de la page, suivie jusqu'en bas. Observe le bloc coloré du haut : il ne change jamais. Tout le reste est de l'emballage, ajouté par une couche qui sera jetée par l'appareil suivant, ou que seule l'autre extrémité ouvrira. La charge utile garde son identité. Les emballages, non.",

  'chapter.physical.title': "Dans l'air",
  'chapter.physical.subtitle': "là où les octets cessent d'être des octets",
  'chapter.physical.body':
    "La trame est brouillée pour cesser de paraître répétitive, doublée en taille pour que les erreurs se corrigent sans redemander d'envoi, mélangée pour qu'une fréquence morte abîme des bits dispersés plutôt qu'une série entière, puis enfin transformée en points sur un plan. Cinquante-deux de ces points partent en même temps, sur cinquante-deux fréquences légèrement différentes, et leur somme est l'onde qui quitte l'antenne.",

  'chapter.hops.title': 'Reconstruit à chaque saut',
  'chapter.hops.subtitle': 'ce que presque tous les schémas ratent',
  'chapter.hops.body':
    "À chaque appareil, l'emballage le plus externe n'est pas transmis. Il est jeté, et un tout nouveau est écrit, pour un médium totalement différent. Le paquet à l'intérieur traverse la radio, le cuivre et le verre sans jamais être réécrit, à une exception près : un compteur qui perd une unité à chaque passage, pour qu'un paquet pris dans une boucle finisse par mourir au lieu de tourner indéfiniment.",

  'chapter.response.title': 'Et le retour',
  'chapter.response.subtitle': 'la page arrive',
  'chapter.response.body':
    "La réponse remonte la même pile à l'envers. Chaque couche retire son propre en-tête, passe le reste au-dessus, et cesse de s'en occuper. Tout en haut, un mur de chiffres devient du texte lisible, et le navigateur a enfin ce que tu avais demandé.",

  // --- interface ------------------------------------------------------------
  'ui.play': 'Lecture',
  'ui.pause': 'Pause',
  'ui.restart': 'Recommencer',
  'ui.speed': 'Vitesse',
  'ui.realTime': 'Écoulé sur le fil',
  'ui.timeScale': 'Échelle de temps',
  'ui.layer': 'Couche',
  'ui.chapter': 'Chapitre',
  'ui.shortcuts':
    'Espace lance la lecture. Les flèches avancent d\'une seconde, avec majuscule d\'un chapitre.',
  'ui.inspector': 'Inspecteur',
  'ui.inspector.empty': "Clique un octet dans la scène, ou un champ dans la liste, pour voir ce que c'est et pourquoi il existe.",
  'ui.bytes': 'octets',
  'ui.overhead': 'emballage',
  'ui.payload': 'charge utile',
  'ui.reconstructed': 'Reconstruit, pas capturé',
  'ui.reconstructed.why':
    "Quand un portable est en Wi-Fi, les outils de capture reçoivent une trame de forme Ethernet : le pilote a déjà retiré l'habillage radio. Voir la vraie trame 802.11 demande le mode moniteur et une seconde machine. Cette trame est construite à partir de la charge utile que la capture prouve avoir été envoyée, et elle est montrée non protégée : sur un réseau WPA, la charge utile porte un en-tête CCMP et un contrôle d'intégrité, et elle est chiffrée entre ici et le point d'accès.",
  'ui.groundTruth': 'Capture réelle',
  'ui.groundTruth.detail': "Chaque octet à l'écran vient d'une vraie session enregistrée sur un vrai réseau.",
  'ui.decrypted': 'Déchiffré en direct',
  'ui.language': 'Langue',
  'ui.of': 'sur',
  'ui.hexDump': 'Octets',
  'ui.fields': 'Champs',
  'ui.noWireTime': "rien ne circule encore",
  'scale.faster': '{n} fois plus rapide que la réalité',
  'scale.slower': '{n} fois plus lent que la réalité',
  'scale.thousand': '{n} mille fois plus lent',
  'scale.million': '{n} millions de fois plus lent',

  // --- libellés dessinés dans la scène 3D -----------------------------------
  'scene.bits': 'bits codés',
  'scene.constellation': 'constellation 64-QAM',
  'scene.subcarriers': '52 sous-porteuses, celle du centre laissée vide',
  'scene.waveform': "l'onde qui quitte l'antenne",
  'scene.bytesAdded': '{n} octets ajoutés par cette couche',
  'scene.payloadBytes': '{n} octets de charge utile',

  // --- explications des champs ---------------------------------------------
  'field.ethernet.dst': "L'adresse matérielle de l'appareil suivant sur ce câble ou ce lien radio, et rien de plus. Ce n'est pas la destination du paquet.",
  'field.ethernet.src': "L'adresse matérielle de l'interface émettrice. Le premier octet porte deux drapeaux, dont l'un dit si l'adresse a été gravée en usine ou choisie par logiciel.",
  'field.ethernet.ethertype': "Deux octets qui disent ce qu'il y a dedans, pour que le récepteur sache à quel analyseur le confier. Sans eux, la charge utile serait un tas d'octets indifférencié.",
  'field.ethernet.mac.local': "Positionné quand l'adresse a été attribuée par logiciel plutôt que par le fabricant. Téléphones et portables tirent désormais leur adresse au hasard exprès, pour que les réseaux ne les reconnaissent pas d'une visite à l'autre.",

  'field.ipv4.version': "Quatre, dans les quatre premiers bits, pour qu'un récepteur distingue un paquet IPv4 d'un IPv6 avant d'analyser quoi que ce soit d'autre.",
  'field.ipv4.ihl': "La longueur de l'en-tête en mots de 32 bits. Cinq mots donnent les vingt octets habituels ; le champ fait quatre bits, ce qui plafonne l'en-tête IPv4 à soixante octets pour toujours.",
  'field.ipv4.total_length': "En-tête et charge utile réunis. C'est ce qui rend le paquet auto-délimité, et c'est pourquoi le bourrage ajouté aux trames Ethernet courtes n'est pas confondu avec des données.",
  'field.ipv4.id': "Un identifiant partagé par tous les fragments d'un même paquet d'origine, pour que l'autre extrémité les distingue d'un autre paquet arrivant au même moment.",
  'field.ipv4.flags': "Trois bits. L'un d'eux, ne pas fragmenter, est la façon dont un émetteur découvre la taille maximale que le chemin accepte : envoie trop gros, et un routeur te le dira au lieu de découper.",
  'field.ipv4.ttl': "Nommé d'après le temps, compté en sauts. Chaque routeur retire une unité, et le paquet est détruit à zéro. C'est la seule chose qui empêche une erreur de routage de remplir le réseau de paquets tournant sans fin.",
  'field.ipv4.protocol': "Indique quel protocole de transport se trouve dedans : six pour TCP, dix-sept pour UDP. Le même rôle que l'EtherType une couche plus bas.",
  'field.ipv4.checksum': "Ne couvre que l'en-tête, jamais la charge utile. Chaque routeur réécrit le compteur de sauts, et recalculer une somme sur tout le paquet à chaque saut serait hors de prix.",
  'field.ipv4.src': "D'où le paquet prétend venir. Rien dans IP ne le vérifie, ce qui est à la racine de toute une famille d'attaques.",
  'field.ipv4.dst': 'Le seul champ que chaque routeur du chemin lit vraiment.',

  'field.udp.length': "En-tête et charge utile. UDP ajoute huit octets et aucune promesse : pas d'ordre, pas de retransmission, pas de connexion. C'est pour cela que DNS l'utilise.",
  'field.udp.checksum': "Optionnel en IPv4, et calculé sur un pseudo-en-tête qui inclut les adresses IP de la couche du dessous. Une entorse délibérée à la séparation des couches, pour qu'un paquet livré au mauvais hôte échoue à sa vérification de transport.",

  'field.tcp.src_port': "Choisi au hasard par le client. C'est ce qui permet à une machine de tenir des centaines de conversations simultanées sur une seule adresse.",
  'field.tcp.dst_port': "Identifie le service plutôt que la machine. 443 signifie que celui qui écoute là parle HTTPS.",
  'field.tcp.seq': "Le numéro du premier octet de ce segment. Il démarre à une valeur aléatoire plutôt qu'à zéro, pour qu'un attaquant qui ne voit pas la connexion ne puisse pas deviner où injecter des données.",
  'field.tcp.ack': "Le prochain numéro d'octet attendu de ce côté. L'accusé est cumulatif : ce nombre dit que tout ce qui précède est arrivé.",
  'field.tcp.flags': "Huit bits qui portent toute la machine à états de la connexion. SYN ouvre, FIN ferme poliment, RST ferme brutalement, ACK confirme.",
  'field.tcp.window': "Combien d'octets supplémentaires ce côté accepte de recevoir maintenant. C'est le récepteur, pas l'émetteur, qui donne le rythme. Ce seul nombre constitue tout le contrôle de flux.",
  'field.tcp.checksum': "Comme UDP, calculé sur un pseudo-en-tête emprunté à IP.",
  'field.tcp.opt.mss': "La plus grande charge utile souhaitée par segment, choisie pour que le paquet fini tienne sur le lien sans être fragmenté.",
  'field.tcp.opt.window_scale': "Le champ fenêtre fait seize bits, ce qui le plafonne à 64 kilooctets : beaucoup trop peu pour un lien moderne. Cette option le multiplie par une puissance de deux, et elle ne peut se négocier que dans les paquets d'ouverture.",
  'field.tcp.opt.timestamps': "Permet à chaque extrémité de mesurer précisément le temps d'aller-retour, et de distinguer un vieux segment dupliqué d'un nouveau légitime.",
  'field.tcp.opt.nop': "Un octet de bourrage. Les options doivent tomber sur des frontières de quatre octets, et l'émetteur comble plutôt que de les réordonner.",

  'field.dns.id': "Seize bits qui apparient une réponse à sa question. Comme DNS circule sur un protocole sans connexion, ce nombre et le port sont tout ce qui les relie.",
  'field.dns.flags.rd': "Récursion souhaitée : le client demande au résolveur de faire toute la chasse, depuis la racine, plutôt que de renvoyer une orientation.",
  'field.dns.qname': "Le nom, écrit comme une suite d'étiquettes préfixées par leur longueur. Il n'y a pas de points sur le fil : 7example3com0.",
  'field.dns.answer': "Une adresse, et la durée pendant laquelle elle peut être mise en cache. Cette durée de vie explique qu'un site puisse être déplacé sans que les visiteurs le remarquent, et qu'une erreur mette des heures à disparaître.",

  'field.tls.record.type': "Une fois la poignée de main terminée, chaque record prétend être des données applicatives, quel qu'en soit le contenu réel. Le vrai type est le dernier octet du texte déchiffré, si bien qu'un observateur ne peut pas distinguer un renouvellement de clé d'une requête de page.",
  'field.tls.record.version': "Figé pour toujours sur la valeur signifiant TLS 1.2. Trop d'équipements intermédiaires sur Internet jettent ce qui annonce une version plus récente, alors TLS 1.3 ment ici et négocie la vraie version dans une extension.",
  'field.tls.ext.server_name': "Le nom du site que tu visites, envoyé en clair, avant que le chiffrement ne commence. Le serveur en a besoin pour choisir quel certificat présenter. Quiconque observe le lien peut le lire.",
  'field.tls.ext.key_share': "Une clé publique, envoyée avant que le serveur ait répondu. Deviner correctement quel échange de clés le serveur acceptera est ce qui permet à TLS 1.3 de finir en un aller-retour au lieu de deux.",
  'field.tls.hello.random': "Trente-deux octets aléatoires frais de chaque côté, mélangés à chaque clé dérivée pour que deux sessions identiques ne produisent jamais les mêmes clés.",

  'field.wifi.fc': "Deux octets qui disent de quel type de trame il s'agit et dans quel sens elle traverse le point d'accès.",
  'field.wifi.duration': "Combien de temps l'émetteur réserve l'air. Toutes les autres stations l'entendent et se taisent. Le Wi-Fi ne peut pas détecter les collisions pendant qu'il émet, alors il réserve le médium à l'avance.",
  'field.wifi.addr1': "Le Wi-Fi porte trois adresses là où Ethernet en porte deux, parce qu'une trame qui traverse un point d'accès a un récepteur et une destination finale qui ne sont pas le même appareil.",
  'field.wifi.snap.ethertype': "Huit octets supplémentaires de LLC et SNAP existent pour transporter les deux octets qui disent qu'IPv4 est à l'intérieur, parce que 802.11 n'a pas de champ EtherType.",

  'field.http.request_line': "La méthode, le chemin, la version. Trois mots, et la raison d'être de tout ce qui se trouve en dessous.",
  'field.http.blank_line': "Deux octets, retour chariot et saut de ligne, deux fois. C'est tout le mécanisme de délimitation : il marque la fin des en-têtes et le début du corps.",



  // --- le trajet à travers le réseau -----------------------------------------
  'hop.laptop': 'Ce portable',
  'hop.access-point': "Point d'accès",
  'hop.home-router': 'Box',
  'hop.isp-edge': "Bordure de l'opérateur",
  'hop.regional-core': 'Cœur régional',
  'hop.peering': "Point d'échange",
  'hop.backbone': 'Dorsale',
  'hop.datacentre-edge': 'Bordure du datacentre',
  'hop.load-balancer': 'Répartiteur de charge',
  'hop.server': 'Le serveur',
  'hop.note.laptop': 'Là où la requête est construite, couche par couche.',
  'hop.note.first': "Retire la trame 802.11 et en écrit une Ethernet. Le paquet IP à l'intérieur n'est pas touché.",
  'hop.note.router': "Ne lit que l'adresse de destination, décrémente le compteur de sauts, réécrit l'en-tête de lien, transmet.",
  'hop.note.server': "Déballe chaque couche à l'envers et lit enfin la requête.",
  'medium.wifi': 'Wi-Fi',
  'medium.copper': 'cuivre',
  'medium.fibre': 'fibre',
  'medium.backbone': 'dorsale',
  'frame.wifi': 'trame 802.11',
  'frame.copper': 'trame Ethernet',
  'frame.fibre': 'habillage fibre',
  'frame.backbone': 'habillage dorsale',

  // --- ce que chaque couche vient d'ajouter ---------------------------------
  'layer.note.payload': "Ce que tu voulais vraiment envoyer. Tout ce qui suit en dessous n'existe que pour transporter ces octets.",
  'layer.note.udp': "N'ajoute presque rien : deux ports, une longueur, une somme de contrôle. C'est tout UDP, et c'est pour ça que DNS l'a choisi.",
  'layer.note.tcp': "Ajoute l'ordre et la garantie de livraison, et un numéro de port pour que le bon programme reçoive les données.",
  'layer.note.tcp.request': "Numérote les octets pour que l'autre extrémité puisse les remettre en ordre, et réclame un accusé de réception.",
  'layer.note.ipv4': "Ajoute les adresses qui rendent le paquet routable à travers tout Internet. Cet en-tête survit à chaque saut.",
  'layer.note.ipv4.request': "Le seul en-tête qui fait tout le trajet sans être modifié, à un champ près : le compteur de sauts.",
  'layer.note.ethernet': "Ajoute des adresses matérielles valables pour un seul lien. Jetées et reconstruites dès l'appareil suivant.",
  'layer.note.ethernet.request': "Valable pour exactement un lien. L'appareil suivant le jette entièrement et écrit le sien.",
  'layer.note.wifi': "Le vrai premier saut. Il coûte {n} octets d'emballage contre {eth} pour Ethernet, parce qu'il lui faut trois adresses, une réservation de temps d'antenne, et huit octets de SNAP rien que pour dire qu'IPv4 est à l'intérieur.",
  'layer.note.wifi.request': "Ce qui quitte réellement l'antenne, avant que quoi que ce soit ne devienne une onde radio.",
  'layer.note.http': "Quelques lignes de texte terminées par une ligne vide. C'est la chose que tout le reste existe pour livrer.",
  'layer.note.tls': "Chiffre la requête et ajoute 16 octets d'étiquette d'authentification. À partir d'ici, plus rien ne peut lire le texte du dessus, et chaque routeur en dessous transporte {n} octets qu'il ne peut pas interpréter.",

  // --- couche physique ------------------------------------------------------
  'phy.scramble': 'Brouillage',
  'phy.scramble.body': "Une longue suite de bits identiques concentrerait toute l'énergie sur une seule fréquence et ne laisserait au récepteur aucune transition pour caler son horloge. Un registre à décalage de sept bits rend les données d'apparence aléatoire, et le récepteur fait tourner le même registre pour défaire l'opération.",
  'phy.encode': "Correction d'erreurs",
  'phy.encode.body': "Chaque bit en devient deux, chacun une parité sur les sept derniers. Un quart est ensuite jeté pour atteindre le débit visé. Ce qui reste permet au récepteur de réparer des bits retournés sans rien redemander, ce qui compte parce qu'à cette couche il n'y a personne à qui demander.",
  'phy.interleave': 'Entrelacement',
  'phy.interleave.body': "Les bits sont mélangés à l'intérieur de chaque symbole. Un creux dans le canal radio efface une fréquence, et le mélange transforme ce qui aurait été une série d'erreurs consécutives en erreurs isolées et dispersées. Les erreurs dispersées sont précisément ce que le code du dessus sait réparer.",
  'phy.map': 'Modulation',
  'phy.map.body': "Six bits à la fois deviennent un point sur un plan, parmi soixante-quatre positions possibles. Les points voisins ne diffèrent que d'un seul bit, si bien que l'erreur la plus probable, confondre un point avec son voisin, coûte un bit et non six.",
  'phy.subcarriers': 'Sous-porteuses',
  'phy.subcarriers.body': "Cinquante-deux fréquences partent en même temps : quarante-huit portent des données, quatre portent des tonalités de référence connues pour que le récepteur mesure la déformation du canal. La fréquence centrale est délibérément laissée vide.",
  'phy.ifft': "L'onde",
  'phy.ifft.body': "Une transformée de Fourier inverse additionne les cinquante-deux fréquences en une seule onde de quatre microsecondes. Son dernier cinquième est recopié devant, comme zone d'atterrissage sacrificielle pour les échos qui rebondissent sur les murs : c'est ce qui rend tout cela possible en intérieur.",
};
