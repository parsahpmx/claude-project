"""Service entry points: the API, the live trader and background workers.

Applications depend on ``core``; ``core`` never depends on an application. A strategy that
imported the API would make the engine unable to run without a web server.
"""
