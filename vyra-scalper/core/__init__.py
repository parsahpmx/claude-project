"""VYRA Scalper Engine — core trading platform packages.

The engine core depends only on the Python standard library (plus PyYAML for
configuration).  Third-party numerical, storage and web stacks live at the edges so the
latency-sensitive event path stays free of large import graphs and hidden allocation.
"""

__version__ = "0.1.0"
