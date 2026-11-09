export async function getTransactions(req: Request, res: Response) {
    // [TASK] : fetch 40 transction first from db and use a cursor pagination. if we fecth first time the cursor is  at 0 after fettching 40 the cursor will be in 41 we will send it to client alsong side the transaction data so next time we will get  ?cursor=41 in query so we 41-1 = 40, and in db query skip the first 40 then take the next 40.
}
export async function getPositions(req: Request, res: Response) {
    // [TASK] : the technique will be same as getTransaction.
}