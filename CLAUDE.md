## Base de connaissances Nodal « Nodal »

Avant de répondre à une question sur ce sujet, de parcourir des fichiers ou de répondre de mémoire, consultez d'abord Nodal (serveur MCP `nodal`) :

- commencez par `nodal_search` : il renvoie le résumé des nœuds et le contenu des documents trouvés, ce qui suffit souvent pour répondre ; pour une question à plusieurs volets, lancez plusieurs recherches en parallèle ;
- approfondissez au besoin avec `nodal_get_node` et `nodal_read_document` ; `nodal_overview` sert à vous orienter quand la question est vague.

Ne lisez les fichiers sources que si Nodal ne suffit pas, et dites-le.

Quand vous apprenez quelque chose de durable (décision, explication, procédure, lien entre deux notions), enregistrez-le dans Nodal : complétez le nœud existant plutôt que d’en créer un nouveau, et reliez les notions avec `nodal_link`. Pour enregistrer plusieurs choses à la fois (nœud, documents, relations, tags), utilisez `nodal_apply` : un seul appel. Chaque modification est journalisée et peut être annulée par l’utilisateur.
