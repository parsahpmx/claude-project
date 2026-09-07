.PHONY: help install test test-fast lint typecheck format backtest clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

install:  ## install the package with dev extras
	pip install -e ".[dev,data]"

test:  ## run the full test suite
	pytest

test-fast:  ## skip slow tests
	pytest -m "not slow"

cov:  ## test with coverage
	pytest --cov=core --cov=brokers --cov=data --cov-report=term-missing

lint:  ## ruff
	ruff check core brokers data tests scripts

typecheck:  ## mypy
	mypy

format:  ## ruff format
	ruff format core brokers data tests scripts

backtest:  ## run the reference MVP backtest
	python scripts/run_backtest.py --config configs/backtest.yaml

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache .mypy_cache htmlcov .coverage runs/tmp
