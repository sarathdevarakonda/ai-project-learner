

export async function createGraph(driver, persons) {
  const [{ name: name1 }, { name: name2 }] = persons;
  const session = driver.session();
  try {
    
    const tx = await session.beginTransaction();

    const isNameExists = async (name, tx) => {
      const result = await tx.run('MATCH (p:Person {name: $name}) RETURN p', { name });
      return result.records.length > 0;

    }
    
    const [first_exists, second_exists] = await Promise.all([
      isNameExists(name1,tx),
      isNameExists(name2,tx)
    ]);

    if (first_exists || second_exists) {
      await tx.rollback();
      return;
    }    // Run a Cypher query
    const result = await tx.run(
      'CREATE (a:Person {name: $name1})-[r:KNOWS]->(b:Person {name: $name2}) RETURN a, r, b',
      { name1, name2 }
    );

    // Output the result
    result.records.forEach(record => {
      console.log(record.get('a').properties);
      console.log(record.get('r').type);
      console.log(record.get('b').properties);
    });

    await tx.commit()
  } catch (error) {
    console.error('Error creating nodes and relationship:', error);
  } finally {
    await session.close();
  }
}

// Run the function to create the graph
