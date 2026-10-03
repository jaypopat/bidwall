# Kamino mainnet fixtures

`mainnet.json.gz` contains public account responses captured on 3 October 2026:
obligations at slot **453057000**, and the market plus its 12 referenced reserves
at slot **453057011**. It includes NVDAx, GOOGLx, USDC and multi-collateral loans.
The capture timestamp is inside the file. RPC URLs and credentials are omitted.

Source: Kamino Lending program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`,
public xStocks market `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua`.
These are unchanged base64 account bytes, not locally stressed demo accounts.

The installed SDK in `spikes/kamino-cpi` provides an independent decoder and
valuation cross-check; it is not a dependency of the risk observer.
